/**
 * monitor/index.js
 * Resource & Security Instrumentation for Node 24
 */
export default class ResourceMonitor {
  constructor(quotas = {}) {
    this.quotas = {
      maxCpuMs: Infinity,
      maxMemoryMb: Infinity,
      maxFsBytes: Infinity,
      ...quotas
    };
    this.usage = { cpuMs: 0, fsBytes: 0, memoryMb: 0 };
    this.cpuStart = process.cpuUsage();
    this.isExhausted = false; // Prevents post-exhaustion execution
    this.disabled = false;    // When true, quota limits are not enforced
  }

  /** Disable quota enforcement (security scanning still runs; monitor becomes passive). */
  disable() {
    this.disabled = true;
  }

  /** Re-enable quota enforcement. Also resets the exhaustion flag and CPU baseline. */
  enable() {
    this.disabled = false;
    this.isExhausted = false;
    this.cpuStart = process.cpuUsage();
  }

  /**
   * Validates resources. Throws QUOTA_EXCEEDED on first hit,
   * then HARD_STOP on any subsequent attempts.
   */
  checkResources() {
    if (!this.disabled && this.isExhausted) {
      throw new Error("HARD_STOP");
    }

    const cpuDiff = process.cpuUsage(this.cpuStart);
    this.usage.cpuMs = (cpuDiff.user + cpuDiff.system) / 1000;

    const mem = process.memoryUsage();
    this.usage.memoryMb = mem.rss / 1024 / 1024;

    if (!this.disabled && (this.usage.cpuMs > this.quotas.maxCpuMs || this.usage.memoryMb > this.quotas.maxMemoryMb)) {
      this.isExhausted = true;
      throw new Error("QUOTA_EXCEEDED");
    }
  }

  instrumentFs(fsModule) {
    const checkQuota = (bytes) => {
      if (!this.disabled && this.usage.fsBytes + bytes > this.quotas.maxFsBytes) {
        throw new Error("FS_QUOTA_EXCEEDED");
      }
      this.usage.fsBytes += bytes;
    };

    // --- Synchronous methods ---
    const originalWriteFileSync = fsModule.writeFileSync;
    if (originalWriteFileSync) {
      fsModule.writeFileSync = (path, data, ...args) => {
        checkQuota(Buffer.byteLength(data));
        return originalWriteFileSync.apply(fsModule, [path, data, ...args]);
      };
    }

    const originalAppendFileSync = fsModule.appendFileSync;
    if (originalAppendFileSync) {
      fsModule.appendFileSync = (path, data, ...args) => {
        checkQuota(Buffer.byteLength(data));
        return originalAppendFileSync.apply(fsModule, [path, data, ...args]);
      };
    }

    const originalCopyFileSync = fsModule.copyFileSync;
    if (originalCopyFileSync) {
      fsModule.copyFileSync = (src, dest, ...args) => {
        const stats = fsModule.statSync(src);
        checkQuota(stats.size);
        return originalCopyFileSync.apply(fsModule, [src, dest, ...args]);
      };
    }

    // --- Callback-based methods ---
    const originalWriteFile = fsModule.writeFile;
    if (originalWriteFile) {
      fsModule.writeFile = (path, data, ...args) => {
        try {
          checkQuota(Buffer.byteLength(data));
        } catch (e) {
          const cb = args[args.length - 1];
          if (typeof cb === 'function') return cb(e);
          throw e;
        }
        return originalWriteFile.apply(fsModule, [path, data, ...args]);
      };
    }

    const originalAppendFile = fsModule.appendFile;
    if (originalAppendFile) {
      fsModule.appendFile = (path, data, ...args) => {
        try {
          checkQuota(Buffer.byteLength(data));
        } catch (e) {
          const cb = args[args.length - 1];
          if (typeof cb === 'function') return cb(e);
          throw e;
        }
        return originalAppendFile.apply(fsModule, [path, data, ...args]);
      };
    }

    const originalCopyFile = fsModule.copyFile;
    if (originalCopyFile) {
      fsModule.copyFile = (src, dest, ...args) => {
        const cb = args[args.length - 1];
        const hasCallback = typeof cb === 'function';

        fsModule.stat(src, (err, stats) => {
          if (err) {
            if (hasCallback) return cb(err);
            throw err;
          }
          try {
            checkQuota(stats.size);
          } catch (e) {
            if (hasCallback) return cb(e);
            throw e;
          }
          return originalCopyFile.apply(fsModule, [src, dest, ...args]);
        });
      };
    }

    // --- Promise-based methods ---
    if (fsModule.promises) {
      const originalPromisesWriteFile = fsModule.promises.writeFile;
      if (originalPromisesWriteFile) {
        fsModule.promises.writeFile = async (path, data, ...args) => {
          checkQuota(Buffer.byteLength(data));
          return originalPromisesWriteFile.apply(fsModule.promises, [path, data, ...args]);
        };
      }

      const originalPromisesAppendFile = fsModule.promises.appendFile;
      if (originalPromisesAppendFile) {
        fsModule.promises.appendFile = async (path, data, ...args) => {
          checkQuota(Buffer.byteLength(data));
          return originalPromisesAppendFile.apply(fsModule.promises, [path, data, ...args]);
        };
      }

      const originalPromisesCopyFile = fsModule.promises.copyFile;
      if (originalPromisesCopyFile) {
        fsModule.promises.copyFile = async (src, dest, ...args) => {
          const stats = await fsModule.promises.stat(src);
          checkQuota(stats.size);
          return originalPromisesCopyFile.apply(fsModule.promises, [src, dest, ...args]);
        };
      }
    }
  }

}
