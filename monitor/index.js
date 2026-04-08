/**
 * monitor/index.js
 * Resource & Security Instrumentation for Node 24
 */
export default class ResourceMonitor {
  constructor(quotas) {
    this.quotas = quotas;
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

  instrumentFs(fsModule) {
    const originalWrite = fsModule.writeFileSync;
    fsModule.writeFileSync = (path, data, ...args) => {
      const bytes = Buffer.byteLength(data);
      if (this.usage.fsBytes + bytes > this.quotas.maxFsBytes) {
        throw new Error("FS_QUOTA_EXCEEDED");
      }
      this.usage.fsBytes += bytes;
      return originalWrite.apply(fsModule, [path, data, ...args]);
    };
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
