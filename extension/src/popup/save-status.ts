import type { SaveJobStatus } from "../shared/messages.js";

export const SAVE_STATUS_POLL_INTERVAL_MS = 1_000;

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export function isActiveSaveJob(job: SaveJobStatus | null): boolean {
  return job?.state === "starting" || job?.state === "running" || job?.state === "cancelling";
}

export function cancellableSaveId(job: SaveJobStatus | null): string | null {
  return job?.state === "running" ? job.saveId : null;
}

export function saveJobStatusText(job: SaveJobStatus | null): string | null {
  if (job === null) {
    return null;
  }
  if (job.state === "starting") {
    return "保存を開始しています…";
  }
  if (job.state === "running") {
    return job.cancelError === undefined
      ? "保存しています…"
      : "キャンセルできませんでした。保存を継続しています。";
  }
  if (job.state === "cancelling") {
    return "キャンセルしています…";
  }
  if (job.state === "completed") {
    return `保存しました: ${job.outputFile}`;
  }
  if (job.state === "cancelled") {
    return "保存をキャンセルしました。";
  }
  if (job.error === "invalid-output-file-name") {
    return "ファイル名が無効です。名前の前後の空白や使用できない文字を確認してください。";
  }
  if (job.error === "output-file-exists") {
    return "同名のファイルが既にあります。別のファイル名を指定してください。";
  }
  if (job.error === "invalid-save-destination") {
    return "保存先が無効です。もう一度選択してください。";
  }
  if (job.error === "output-directory-unavailable") {
    return "保存先を利用できません。フォルダの権限を確認してください。";
  }
  return "保存に失敗しました。";
}

export class SaveStatusPoller {
  private inFlight = false;
  private stopped = true;
  private timerId: number | undefined;

  constructor(
    private readonly fetchStatus: () => Promise<SaveJobStatus | null>,
    private readonly onStatus: (job: SaveJobStatus | null) => void,
    private readonly onError: () => void,
    private readonly scheduler: TimerScheduler,
    private readonly intervalMs = SAVE_STATUS_POLL_INTERVAL_MS,
  ) {}

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    void this.refresh();
  }

  stop(): void {
    this.stopped = true;
    if (this.timerId !== undefined) {
      this.scheduler.clearTimeout(this.timerId);
      this.timerId = undefined;
    }
  }

  private scheduleNext(): void {
    if (this.stopped || this.timerId !== undefined) {
      return;
    }
    this.timerId = this.scheduler.setTimeout(() => {
      this.timerId = undefined;
      void this.refresh();
    }, this.intervalMs);
  }

  private async refresh(): Promise<void> {
    if (this.stopped || this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const job = await this.fetchStatus();
      if (this.stopped) {
        return;
      }
      this.onStatus(job);
      if (isActiveSaveJob(job)) {
        this.scheduleNext();
      } else {
        this.stopped = true;
      }
    } catch {
      if (!this.stopped) {
        this.stopped = true;
        this.onError();
      }
    } finally {
      this.inFlight = false;
    }
  }
}
