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
      fetchRules: [],
      ...quotas
    };
    this.usage = { cpuMs: 0, fsBytes: 0, memoryMb: 0, fetchCount: 0 };
    this.cpuStart = process.cpuUsage();
    this.isExhausted = false; // Prevents post-exhaustion execution
  }

  /**
   * Validates resources. Throws QUOTA_EXCEEDED on first hit,
   * then HARD_STOP on any subsequent attempts.
   */
  checkResources() {
    if (this.isExhausted) {
      throw new Error("HARD_STOP");
    }

    const cpuDiff = process.cpuUsage(this.cpuStart);
    this.usage.cpuMs = (cpuDiff.user + cpuDiff.system) / 1000;
    
    const mem = process.memoryUsage();
    this.usage.memoryMb = mem.rss / 1024 / 1024;

    if (this.usage.cpuMs > this.quotas.maxCpuMs || this.usage.memoryMb > this.quotas.maxMemoryMb) {
      this.isExhausted = true;
      throw new Error("QUOTA_EXCEEDED");
    }
  }

  _checkFsQuota(data, length) {
    let bytes = 0;
    if (typeof data === 'string') {
      bytes = Buffer.byteLength(data);
    } else if (data instanceof Uint8Array) {
      bytes = (length !== undefined) ? length : data.byteLength;
    } else if (Array.isArray(data) && data.every(b => b instanceof Uint8Array)) {
      bytes = data.reduce((acc, b) => acc + b.byteLength, 0);
    } else if (data === null && typeof length === 'number') {
      bytes = length;
    }

    if (this.usage.fsBytes + bytes > this.quotas.maxFsBytes) {
      throw new Error("FS_QUOTA_EXCEEDED");
    }
    this.usage.fsBytes += bytes;
  }

  instrumentFs(fsModule) {
    const self = this;

    // Sync Methods
    const syncMethods = ['writeFileSync', 'appendFileSync'];
    syncMethods.forEach(m => {
      if (typeof fsModule[m] === 'function') {
        const orig = fsModule[m];
        fsModule[m] = function(path, data, ...args) {
          self._checkFsQuota(data);
          return orig.apply(this, [path, data, ...args]);
        };
      }
    });

    if (typeof fsModule.writeSync === 'function') {
      const orig = fsModule.writeSync;
      fsModule.writeSync = function(fd, data, ...args) {
        let length;
        if (typeof data !== 'string' && typeof args[1] === 'number') {
          length = args[1]; // writeSync(fd, buffer, offset, length, position)
        }
        self._checkFsQuota(data, length);
        return orig.apply(this, [fd, data, ...args]);
      };
    }

    if (typeof fsModule.writevSync === 'function') {
      const orig = fsModule.writevSync;
      fsModule.writevSync = function(fd, buffers, ...args) {
        self._checkFsQuota(buffers);
        return orig.apply(this, [fd, buffers, ...args]);
      };
    }

    // Async Callback Methods
    const asyncMethods = ['writeFile', 'appendFile'];
    asyncMethods.forEach(m => {
      if (typeof fsModule[m] === 'function') {
        const orig = fsModule[m];
        fsModule[m] = function(path, data, ...args) {
          self._checkFsQuota(data);
          return orig.apply(this, [path, data, ...args]);
        };
      }
    });

    if (typeof fsModule.write === 'function') {
      const orig = fsModule.write;
      fsModule.write = function(fd, data, ...args) {
        let length;
        if (typeof data !== 'string' && typeof args[1] === 'number') {
          length = args[1]; // write(fd, buffer, offset, length, position, callback)
        }
        self._checkFsQuota(data, length);
        return orig.apply(this, [fd, data, ...args]);
      };
    }

    if (typeof fsModule.writev === 'function') {
      const orig = fsModule.writev;
      fsModule.writev = function(fd, buffers, ...args) {
        self._checkFsQuota(buffers);
        return orig.apply(this, [fd, buffers, ...args]);
      };
    }

    // Promises
    if (fsModule.promises) {
      const p = fsModule.promises;
      const pMethods = ['writeFile', 'appendFile'];
      pMethods.forEach(m => {
        if (typeof p[m] === 'function') {
          const orig = p[m];
          p[m] = function(path, data, ...args) {
            self._checkFsQuota(data);
            return orig.apply(this, [path, data, ...args]);
          };
        }
      });

      if (typeof p.open === 'function') {
        const origOpen = p.open;
        p.open = async function(...args) {
          const handle = await origOpen.apply(this, args);
          if (handle && typeof handle === 'object') {
            const hMethods = ['writeFile', 'appendFile'];
            hMethods.forEach(m => {
              if (typeof handle[m] === 'function') {
                const origM = handle[m];
                handle[m] = function(data, ...mArgs) {
                  self._checkFsQuota(data);
                  return origM.apply(this, [data, ...mArgs]);
                };
              }
            });
            if (typeof handle.write === 'function') {
              const origWrite = handle.write;
              handle.write = function(data, ...mArgs) {
                let length;
                if (typeof data !== 'string' && typeof mArgs[1] === 'number') {
                  length = mArgs[1];
                }
                self._checkFsQuota(data, length);
                return origWrite.apply(this, [data, ...mArgs]);
              };
            }
            if (typeof handle.writev === 'function') {
              const origWritev = handle.writev;
              handle.writev = function(buffers, ...mArgs) {
                self._checkFsQuota(buffers);
                return origWritev.apply(this, [buffers, ...mArgs]);
              };
            }
          }
          return handle;
        };
      }
    }

    // Streams
    if (typeof fsModule.createWriteStream === 'function') {
      const orig = fsModule.createWriteStream;
      fsModule.createWriteStream = function(...args) {
        const stream = orig.apply(this, args);
        const origWrite = stream.write;
        stream.write = function(chunk, ...writeArgs) {
          self._checkFsQuota(chunk);
          return origWrite.apply(this, [chunk, ...writeArgs]);
        };
        const origEnd = stream.end;
        stream.end = function(chunk, ...endArgs) {
          if (chunk && typeof chunk !== 'function') {
            self._checkFsQuota(chunk);
          }
          return origEnd.apply(this, [chunk, ...endArgs]);
        };
        return stream;
      };
    }
  }

  instrumentFetch(globalFetch) {
    return async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      const urlStr = typeof url === 'string' ? url : url.href;

      const rule = this.quotas.fetchRules.find(r => {
        const pattern = new URLPattern(r.pattern);
        return pattern.test(urlStr) && r.methods.includes(method);
      });

      if (!rule) throw new Error(`FETCH_BLOCKED: ${method} ${urlStr}`);

      const requestHeaders = options.headers instanceof Headers 
        ? Object.fromEntries(options.headers.entries()) 
        : (options.headers || {});

      if (rule.forbiddenHeaders) {
        const sentKeys = Object.keys(requestHeaders).map(k => k.toLowerCase());
        for (const forbidden of rule.forbiddenHeaders) {
          if (sentKeys.includes(forbidden.toLowerCase())) throw new Error("FORBIDDEN_HEADER");
        }
      }

      if (rule.forcedHeaders) Object.assign(requestHeaders, rule.forcedHeaders);
      options.headers = requestHeaders;
      this.usage.fetchCount++;

      return globalFetch(url, options);
    };
  }
}
