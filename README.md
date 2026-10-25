# GameNest

App Electron + React dành cho Windows, giao diện Điện ảnh. Catalog lấy từ HTML của FitGirl; bộ tải C++ dùng libtorrent 2.0.11 trong tiến trình riêng. Người dùng không cần cài qBittorrent hay Python.

## Đã có

- Catalog thật: ảnh bìa, tên game, thể loại, dung lượng; tìm kiếm trên nguồn, phân trang, lọc thể loại trong trang hiện tại.
- Chi tiết game và lựa chọn magnet trực tiếp được tìm thấy trong bài viết.
- Yêu thích được lưu cục bộ.
- Thêm magnet hoặc file `.torrent`, hiển thị tiến độ/tốc độ/peer/thời gian còn lại, tạm dừng/tiếp tục, chọn file, mở thư mục, gỡ tác vụ và giữ dữ liệu đã tải.
- Giới hạn tốc độ, số tác vụ đồng thời, tùy chọn seed, chạy trong khay hệ thống.
- Lưu danh sách tác vụ, lựa chọn file và resume data; khôi phục khi mở lại.
- Cache catalog 1 giờ, chi tiết 24 giờ; request HTML nối tiếp cách nhau tối thiểu 1,5 giây. Khi nguồn lỗi, catalog đã lưu vẫn hiển thị cùng thông báo.
- DNS mã hóa Cloudflare, tự chuyển proxy HTTP/SOCKS5 và quản lý WARP cục bộ.
- Renderer sandboxed, IPC được kiểm tra, nội dung từ nguồn chỉ hiển thị dạng văn bản và ảnh.

## Chạy development

Cần Node.js 22.12 trở lên. Dependency được khóa bằng `package-lock.json`.

```sh
npm ci
npm run native:build
npm run dev
```

`native:build` cần compiler C++17, CMake và libtorrent/Boost/OpenSSL. Có thể dùng vcpkg theo hướng dẫn Windows bên dưới.

Trên máy Mac hiện tại đã có binary engine tại `native/bin/gamenest-engine`. Có thể chạy ngay `npm run dev`. Để build lại bằng các thư viện đã có của Reel:

```sh
GAMENEST_LIBTORRENT_VENDOR=/Users/duyta/app/mine/Reel/Vendor npm run native:build
```

Biến này chỉ chỉ định thư mục dependency phục vụ build trên Mac; app đã đóng gói không phụ thuộc project Reel. Không sửa file trong Reel.

## Build Windows x64

Cần Windows, Node.js 22, Git, CMake và Visual Studio Build Tools với workload Desktop development with C++. Chạy trong Developer PowerShell:

```powershell
git clone --branch 2025.06.13 --depth 1 https://github.com/microsoft/vcpkg.git .build-tools/vcpkg
& .build-tools/vcpkg/bootstrap-vcpkg.bat -disableMetrics
$env:VCPKG_ROOT = (Resolve-Path .build-tools/vcpkg).Path
npm ci
npm run native:build
npm run native:test
npm test
npm run package:win
```

Binary Windows được liên kết static với dependency native; các giấy phép được chép vào bộ cài. Bộ cài NSIS nằm trong `release/`, cho phép chọn thư mục cài đặt.

Workflow `.github/workflows/windows.yml` có thể chạy thủ công hoặc khi đẩy tag `v*`. Workflow khóa vcpkg ở bản 2025.06.13, tương ứng libtorrent 2.0.11. Chưa chạy workflow này lên GitHub và chưa xác minh bộ cài trên Windows.

## Kiểm tra

```sh
pnpm fix
npm run typecheck
npm test
npm run native:test
npm run build
npm run test:desktop
```

`native:test` tạo file 512 KB, truyền giữa hai peer localhost, đối chiếu byte và kiểm tra resume data; không tải torrent từ Internet. Trong sandbox chặn socket localhost, kiểm thử này cần chạy ngoài sandbox.

`test:desktop` mở Electron bằng Playwright, dùng profile tạm riêng: kiểm tra catalog/chi tiết/tìm kiếm thật, yêu thích, cài đặt, nhập torrent tự tạo, mở lại app, giữ file khi gỡ tác vụ. Bài kiểm tra này cần kết nối đến FitGirl và môi trường desktop; không bấm tải game trên nguồn. Ảnh chụp mặc định ở `test-results/desktop.png`; có thể đổi bằng `GAMENEST_SCREENSHOT`.

## Mạng và dữ liệu

Proxy trong Cài đặt áp dụng cho crawler và ảnh bìa theo tuyến danh mục gần nhất. Kết nối peer/tracker của libtorrent dùng đường mạng hệ thống; nếu cần VPN cho torrent, cấu hình ở hệ điều hành. DNS mã hóa không thay thế VPN khi mạng chặn IP hoặc HTTPS.

Crawler hiện lấy magnet trực tiếp trong bài. Chưa xử lý các trang trung gian hoặc link `.torrent` được mã hóa trên dịch vụ paste; vẫn có thể nhập file torrent thủ công. App chỉ tải dữ liệu, chưa tự chạy trình cài game.

Dữ liệu người dùng nằm ở thư mục `userData` của Electron (`%APPDATA%/gamenest` trên Windows). Đóng cửa sổ mặc định thu xuống khay; để thoát hoàn toàn và lưu trạng thái, chọn **Thoát và lưu tiến độ** trong menu khay hoặc dùng lệnh Quit của hệ điều hành.

## Cấu trúc

- `src/main/`: crawler, parser, cache, lưu trữ, IPC, quản lý engine.
- `src/preload/`: API giới hạn giữa renderer và main process.
- `src/renderer/`: giao diện React.
- `src/shared/`: hợp đồng dữ liệu dùng chung.
- `native/`: engine C++, CMake và manifest vcpkg.
- `tests/`, `scripts/`: kiểm tra parser/cache/lưu trữ/IPC và luồng desktop.

## Trạng thái xác minh

Đã kiểm tra trên macOS arm64: typecheck, formatter/linter, 12 test tự động, truyền torrent nội bộ và luồng Electron với dữ liệu nguồn thật. Chưa kiểm tra tải game lớn hoặc build/chạy bản Windows.

### Kết nối mạng

Trong Cài đặt → Kết nối nguồn game, chọn Tự động để thử mạng trực tiếp rồi chuyển sang proxy khi gặp lỗi mạng, timeout hoặc HTTP 403/451/502/503/504. Kết nối proxy thành công được ghi nhớ trong 10 phút. Chế độ Luôn dùng proxy sẽ báo lỗi nếu proxy không sẵn sàng.

Mặc định dùng WARP localhost `http://127.0.0.1:40000`. Cần cài và mở Cloudflare WARP một lần. Nút Chuẩn bị WARP hoặc lần truy cập cần proxy khi bật Tự quản lý WARP sẽ chuyển WARP sang chế độ proxy cục bộ, thay cho VPN toàn máy. Proxy ngoài hỗ trợ HTTP/HTTPS/SOCKS5 không xác thực; tắt Tự quản lý WARP trước khi dùng.

Danh mục đi qua tuyến đã chọn; ảnh game theo tuyến danh mục gần nhất. Peer và tracker libtorrent vẫn dùng mạng hệ thống. Kiểm tra kết nối hiển thị tuyến thực tế và trạng thái WARP/proxy.

### Ngôn ngữ giao diện

Mặc định là English, kể cả cấu hình cũ chưa có lựa chọn ngôn ngữ. Đổi tại Settings → Language / Cài đặt → Ngôn ngữ. Lựa chọn được lưu ngay và áp dụng cho giao diện, thông báo, hộp thoại và menu khay. Nội dung từ FitGirl giữ nguyên ngôn ngữ nguồn.

### Cập nhật ứng dụng

Cơ chế giống Reel: dùng electron-updater, kiểm tra khi mở app và mỗi 6 giờ, tải nền khi có phiên bản ổn định mới hơn. Mở Settings → App updates / Cài đặt → Cập nhật ứng dụng để kiểm tra thủ công, xem tiến độ và ghi chú phát hành. Bản tải xong chỉ được cài khi bấm Restart to update; không tự cài lúc thoát app. Tạm dừng toàn bộ tác vụ tải đang chạy trước khi cài. GameNest lưu thư viện/cài đặt/tiến độ và chờ bộ tải native thoát trước khi gọi trình cài.

Nguồn phát hành: https://github.com/duyta7598/gamenest-releases (public, chỉ chứa bộ cài và metadata). Mã nguồn game-nest vẫn private. Không nhúng token GitHub vào app. Tăng version trong package.json trước mỗi release mới; không phát hành prerelease hoặc hạ phiên bản qua updater. Các bản 0.1.0 đã phát hành trước khi thêm updater cần cài thủ công một lần để có tính năng này.

- Windows: `npm run package:win:release`, phát hành file .exe, .exe.blockmap và latest.yml cùng một release public. Workflow Windows thu thập đủ ba loại file này và không tự publish.
- macOS: `GAMENEST_MAC_SIGN_IDENTITY="Developer ID Application: ..." npm run package:mac:release`, phát hành .dmg, .zip, blockmap và latest-mac.yml. Cần Developer ID Application và thiết lập notarization phù hợp để phân phối. Bản local ký ad-hoc hoặc bản dev sẽ tắt updater và hiển thị lý do. `npm run package:mac` vẫn dùng cho bản local.
- Repo phát hành mới chưa có bản/metadata; cần đưa một bản release đầy đủ lên đó để kiểm tra cập nhật qua mạng. Không đưa riêng file exe mà thiếu latest.yml.
