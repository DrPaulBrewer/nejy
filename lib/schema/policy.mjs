export const PolicySchema = {
    type: "object",
    properties: {
        maxRisk: {
            enum: ["LOW", "MEDIUM", "HIGH", "INSANE"],
            default: "LOW"
        },
        quotas: {
            type: "object",
            properties: {
                maxCpuMs: { type: "number", minimum: 0 },
                maxMemoryMb: { type: "number", minimum: 0 },
                maxFsBytes: { type: "number", minimum: 0 }
            },
            required: ["maxCpuMs", "maxMemoryMb", "maxFsBytes"],
            additionalProperties: false
        }
    },
    required: ["quotas"],
    additionalProperties: false
};