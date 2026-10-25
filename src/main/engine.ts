import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}
export class TorrentEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  error = '';
  get ready() {
    return Boolean(this.child);
  }

  start(executable: string, directory: string) {
    if (!existsSync(executable)) {
      this.error = 'Chưa có bộ tải native. Chạy npm run native:build trước khi mở app.';
      return;
    }
    const child = spawn(executable, [directory], { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const response = JSON.parse(line) as {
          request: number;
          ok: boolean;
          data: unknown;
          error?: string;
        };
        const pending = this.pending.get(response.request);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(response.request);
        if (response.ok) pending.resolve(response.data);
        else pending.reject(new Error(response.error || 'Lỗi bộ tải torrent.'));
      } catch {
        this.error = 'Bộ tải trả về dữ liệu không hợp lệ.';
      }
    });
    child.stderr.resume();
    const failed = (message: string) => {
      this.error = message;
      this.child = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(message));
      }
      this.pending.clear();
    };
    child.on('error', (error) => failed(error.message));
    child.on('exit', (code) =>
      failed(
        code === 0 ? '' : 'Bộ tải đã dừng bất thường. Khởi động lại app để khôi phục các tác vụ.',
      ),
    );
  }

  request<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.child) return Promise.reject(new Error(this.error || 'Bộ tải chưa sẵn sàng.'));
    const request = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request);
        reject(new Error('Bộ tải không phản hồi.'));
      }, 15000);
      this.pending.set(request, { resolve: (value) => resolve(value as T), reject, timer });
      this.child?.stdin.write(`${JSON.stringify({ request, command, ...args })}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(request);
          reject(error);
        }
      });
    });
  }

  async shutdown(strict = false) {
    const child = this.child;
    if (!child) return;
    let timer: NodeJS.Timeout | undefined;
    const exited = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 20000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    try {
      await this.request('shutdown');
      if (!(await exited)) throw new Error('The download engine did not stop in time.');
    } catch (error) {
      clearTimeout(timer);
      child.kill();
      if (strict) throw error;
    }
  }
}
