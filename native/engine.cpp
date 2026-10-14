#include <libtorrent/session.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/write_resume_data.hpp>
#include <libtorrent/create_torrent.hpp>
#include <libtorrent/version.hpp>
#include <boost/property_tree/ptree.hpp>
#include <boost/property_tree/json_parser.hpp>
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <thread>
#ifdef _WIN32
#include <windows.h>
#endif

namespace lt = libtorrent;
namespace fs = std::filesystem;
namespace pt = boost::property_tree;

static std::string quoted(std::string const& value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') out << '\\' << c;
        else if (c < 32) {
            const char* hex = "0123456789abcdef";
            out << "\\u00" << hex[c >> 4] << hex[c & 15];
        } else out << c;
    }
    out << '"';
    return out.str();
}

static void replace_file(fs::path const& temporary, fs::path const& target) {
#ifdef _WIN32
    if (!MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
        throw std::runtime_error("Could not save torrent resume data");
#else
    fs::rename(temporary, target);
#endif
}

struct Engine {
    lt::session session;
    fs::path directory;
    std::map<std::string, lt::torrent_handle> handles;
    std::set<std::string> saving;
    bool seed_after = false;
    int snapshots = 0;

    static lt::settings_pack settings(bool local) {
        lt::settings_pack value;
        value.set_str(lt::settings_pack::user_agent, "GameNest/0.1");
        value.set_int(lt::settings_pack::alert_mask, lt::alert_category::storage | lt::alert_category::error | lt::alert_category::status);
        value.set_int(lt::settings_pack::active_downloads, 2);
        value.set_int(lt::settings_pack::active_seeds, 2);
        value.set_int(lt::settings_pack::active_limit, 4);
        if (local) {
            value.set_bool(lt::settings_pack::enable_dht, false);
            value.set_bool(lt::settings_pack::enable_lsd, false);
            value.set_bool(lt::settings_pack::enable_upnp, false);
            value.set_bool(lt::settings_pack::enable_natpmp, false);
            value.set_bool(lt::settings_pack::enable_outgoing_utp, false);
            value.set_bool(lt::settings_pack::enable_incoming_utp, false);
            value.set_str(lt::settings_pack::listen_interfaces, "127.0.0.1:0");
        }
        return value;
    }

    explicit Engine(fs::path path, bool local = false) : session(settings(local)), directory(std::move(path)) {
        fs::create_directories(directory);
    }

    std::string checked_id(std::string const& id) {
        if (id.empty() || id.size() > 80 || !std::all_of(id.begin(), id.end(), [](unsigned char c) {
            return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
        })) throw std::runtime_error("Invalid torrent id");
        return id;
    }

    void alerts() {
        std::vector<lt::alert*> list;
        session.pop_alerts(&list);
        for (auto* alert : list) {
            if (auto* saved = lt::alert_cast<lt::save_resume_data_alert>(alert)) {
                for (auto const& [id, handle] : handles) {
                    if (handle != saved->handle) continue;
                    const auto bytes = lt::write_resume_data_buf(saved->params);
                    const auto target = directory / (id + ".resume");
                    const auto temporary = directory / (id + ".resume.tmp");
                    std::ofstream out(temporary, std::ios::binary);
                    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
                    out.close();
                    if (!out) throw std::runtime_error("Could not write torrent resume data");
                    replace_file(temporary, target);
                    saving.erase(id);
                }
            }
            if (auto* failed = lt::alert_cast<lt::save_resume_data_failed_alert>(alert)) {
                for (auto const& [id, handle] : handles) if (handle == failed->handle) saving.erase(id);
            }
        }
    }

    void save() {
        for (auto const& [id, handle] : handles) {
            if (saving.insert(id).second) handle.save_resume_data(lt::torrent_handle::save_info_dict);
        }
    }

    void flush() {
        save();
        for (int i = 0; i < 80 && !saving.empty(); ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            alerts();
        }
    }

    void add(pt::ptree const& command) {
        const auto id = checked_id(command.get<std::string>("id"));
        if (handles.count(id)) return;
        lt::add_torrent_params params;
        bool restored = false;
        std::ifstream in(directory / (id + ".resume"), std::ios::binary);
        std::vector<char> data((std::istreambuf_iterator<char>(in)), {});
        if (!data.empty()) {
            lt::error_code error;
            params = lt::read_resume_data(data, error);
            restored = !error;
        }
        if (!restored) {
            const auto source = command.get<std::string>("source");
            if (source.rfind("magnet:", 0) == 0) params = lt::parse_magnet_uri(source);
            else params.ti = std::make_shared<lt::torrent_info>(source);
        }
        params.save_path = command.get<std::string>("savePath");
        params.flags |= lt::torrent_flags::duplicate_is_error;
        if (command.get<bool>("paused", false)) {
            params.flags |= lt::torrent_flags::paused;
            params.flags &= ~lt::torrent_flags::auto_managed;
        } else {
            params.flags &= ~lt::torrent_flags::paused;
            params.flags |= lt::torrent_flags::auto_managed;
        }
        auto h = session.add_torrent(params);
        handles.emplace(id, h);
    }

    std::string snapshot() {
        alerts();
        if (++snapshots % 15 == 0) save();
        std::ostringstream out;
        out << '[';
        bool first = true;
        for (auto const& [id, handle] : handles) {
            auto s = handle.status();
            if (s.is_finished && !seed_after) {
                handle.unset_flags(lt::torrent_flags::auto_managed);
                handle.pause();
            }
            if (!first) out << ',';
            first = false;
            out << "{\"id\":" << quoted(id) << ",\"name\":" << quoted(s.name)
                << ",\"progress\":" << s.progress << ",\"downloadRate\":" << s.download_payload_rate
                << ",\"uploadRate\":" << s.upload_payload_rate << ",\"downloaded\":" << s.total_wanted_done
                << ",\"total\":" << s.total_wanted << ",\"peers\":" << s.num_peers
                << ",\"paused\":" << ((s.flags & lt::torrent_flags::paused) ? "true" : "false")
                << ",\"finished\":" << (s.is_finished ? "true" : "false")
                << ",\"metadata\":" << (s.has_metadata ? "true" : "false")
                << ",\"state\":" << static_cast<int>(s.state)
                << ",\"error\":" << quoted(s.errc ? s.errc.message() : "") << '}';
        }
        out << ']';
        return out.str();
    }

    std::string files(std::string const& id) {
        const auto handle = handles.at(id);
        const auto info = handle.torrent_file();
        if (!info) return "[]";
        const auto priorities = handle.get_file_priorities();
        std::vector<std::int64_t> progress;
        handle.file_progress(progress);
        std::ostringstream out;
        out << '[';
        bool first = true;
        for (auto i : info->files().file_range()) {
            if (!first) out << ',';
            first = false;
            const int index = static_cast<int>(i);
            out << "{\"index\":" << index << ",\"path\":" << quoted(info->files().file_path(i))
                << ",\"size\":" << info->files().file_size(i)
                << ",\"downloaded\":" << (index < static_cast<int>(progress.size()) ? progress[index] : 0)
                << ",\"selected\":" << ((index < static_cast<int>(priorities.size()) && priorities[index] != lt::dont_download) ? "true" : "false") << '}';
        }
        out << ']';
        return out.str();
    }

    std::string execute(pt::ptree const& command) {
        const auto action = command.get<std::string>("command");
        if (action == "snapshot") return snapshot();
        if (action == "configure") {
            lt::settings_pack pack;
            const int max = std::clamp(command.get<int>("maxDownloads", 2), 1, 10);
            pack.set_int(lt::settings_pack::active_downloads, max);
            pack.set_int(lt::settings_pack::active_seeds, max);
            pack.set_int(lt::settings_pack::active_limit, max * 2);
            pack.set_int(lt::settings_pack::download_rate_limit, std::clamp(command.get<int>("downloadLimit", 0), 0, 1048576) * 1024);
            pack.set_int(lt::settings_pack::upload_rate_limit, std::clamp(command.get<int>("uploadLimit", 0), 0, 1048576) * 1024);
            seed_after = command.get<bool>("seedAfterDownload", false);
            session.apply_settings(pack);
            return "null";
        }
        if (action == "add") { add(command); return "null"; }
        if (action == "shutdown") { flush(); return "null"; }
        const auto id = checked_id(command.get<std::string>("id"));
        const auto h = handles.at(id);
        if (action == "pause") {
            if (command.get<bool>("paused")) { h.unset_flags(lt::torrent_flags::auto_managed); h.pause(); }
            else { h.set_flags(lt::torrent_flags::auto_managed); h.resume(); }
            save();
        } else if (action == "remove") {
            session.remove_torrent(h);
            handles.erase(id);
            saving.erase(id);
            fs::remove(directory / (id + ".resume"));
        } else if (action == "files") return files(id);
        else if (action == "selectFiles") {
            const auto info = h.torrent_file();
            if (!info) throw std::runtime_error("Torrent metadata is not available yet");
            std::vector<lt::download_priority_t> priorities(info->num_files(), lt::dont_download);
            int selected = 0;
            for (auto const& child : command.get_child("indexes")) {
                const int index = child.second.get_value<int>();
                if (index < 0 || index >= info->num_files()) throw std::runtime_error("Invalid file index");
                priorities[index] = lt::default_priority;
                ++selected;
            }
            if (!selected) throw std::runtime_error("Select at least one file");
            h.prioritize_files(priorities);
            save();
        } else throw std::runtime_error("Unknown torrent command");
        return "null";
    }
};

static int self_test(fs::path const& base) {
    fs::create_directories(base / "seed");
    const auto source = base / "seed" / "fixture.bin";
    std::vector<char> payload(512 * 1024);
    for (std::size_t i = 0; i < payload.size(); ++i) payload[i] = static_cast<char>((i * 31 + i / 97) % 256);
    { std::ofstream out(source, std::ios::binary); out.write(payload.data(), payload.size()); }
    lt::file_storage files;
    lt::add_files(files, source.u8string());
    lt::create_torrent creator(files, 16384);
    lt::set_piece_hashes(creator, (base / "seed").u8string());
    const auto bytes = creator.generate_buf();
    auto info = std::make_shared<lt::torrent_info>(bytes.data(), static_cast<int>(bytes.size()));
    auto settings = Engine::settings(true);
    lt::session seeder(settings);
    lt::add_torrent_params seed;
    seed.ti = info;
    seed.save_path = (base / "seed").u8string();
    seed.flags |= lt::torrent_flags::seed_mode;
    seed.flags &= ~lt::torrent_flags::paused;
    seed.flags &= ~lt::torrent_flags::auto_managed;
    auto seed_handle = seeder.add_torrent(seed);
    Engine downloader(base / "state", true);
    lt::add_torrent_params get;
    get.ti = info;
    get.save_path = (base / "download").u8string();
    get.flags &= ~lt::torrent_flags::paused;
    get.flags &= ~lt::torrent_flags::auto_managed;
    auto handle = downloader.session.add_torrent(get);
    downloader.handles.emplace("fixture", handle);
    for (int i = 0; i < 400; ++i) {
        if (seeder.listen_port() > 0 && i % 20 == 0) handle.connect_peer({lt::make_address("127.0.0.1"), static_cast<unsigned short>(seeder.listen_port())});
        if (handle.status().is_seeding) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    if (!handle.status().is_seeding) throw std::runtime_error("Local peer transfer timed out");
    std::ifstream in(base / "download" / "fixture.bin", std::ios::binary);
    std::vector<char> received((std::istreambuf_iterator<char>(in)), {});
    if (received != payload) throw std::runtime_error("Downloaded bytes do not match");
    downloader.flush();
    std::ifstream resume(base / "state" / "fixture.resume", std::ios::binary);
    std::vector<char> resume_bytes((std::istreambuf_iterator<char>(resume)), {});
    lt::error_code error;
    auto restored = lt::read_resume_data(resume_bytes, error);
    if (error || !restored.ti) throw std::runtime_error("Resume data could not be restored");
    std::cout << "{\"ok\":true,\"bytes\":" << received.size() << ",\"resume\":true,\"internet\":false}" << std::endl;
    return 0;
}

int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--version") {
            std::cout << "{\"engine\":\"libtorrent\",\"version\":" << quoted(LIBTORRENT_VERSION) << '}' << std::endl;
            return 0;
        }
        if (argc == 3 && std::string(argv[1]) == "--self-test") return self_test(fs::u8path(argv[2]));
        if (argc != 2) return 2;
        Engine engine(fs::u8path(argv[1]));
        std::string line;
        while (std::getline(std::cin, line)) {
            int request = 0;
            try {
                if (line.size() > 1024 * 1024) throw std::runtime_error("Command too large");
                std::istringstream input(line);
                pt::ptree command;
                pt::read_json(input, command);
                request = command.get<int>("request");
                const auto data = engine.execute(command);
                std::cout << "{\"request\":" << request << ",\"ok\":true,\"data\":" << data << '}';
                std::cout << std::endl;
                if (command.get<std::string>("command") == "shutdown") return 0;
            } catch (std::exception const& error) {
                std::cout << "{\"request\":" << request << ",\"ok\":false,\"error\":" << quoted(error.what()) << '}' << std::endl;
            }
        }
        engine.flush();
    } catch (std::exception const& error) {
        std::cout << "{\"request\":0,\"ok\":false,\"error\":" << quoted(error.what()) << '}' << std::endl;
        return 1;
    }
    return 0;
}
