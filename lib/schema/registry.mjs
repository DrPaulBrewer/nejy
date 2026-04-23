export const RegistryFileSchema = {
    type: "object",
    properties: {
        entries: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    key: { type: "string" },
                    src: { enum: ["import", "global"] },
                    module: { type: "string" },
                    risk: { enum: ["LOW", "MEDIUM", "HIGH", "INSANE"], default: "LOW" },
                    methods: {
                        anyOf: [
                            { const: "*" },
                            {
                                type: "object",
                                patternProperties: {
                                    ".*": { type: "string" }
                                }
                            }
                        ]
                    },
                    overrides: {
                        type: "object",
                        patternProperties: {
                            ".*": { type: "string" }
                        }
                    },
                    setup: {
                        type: "array",
                        items: {}
                    },
                    freezePrototypes: { type: "boolean" }
                },
                required: ["key", "src"],
                additionalProperties: false
            }
        }
    },
    required: ["entries"],
    additionalProperties: false
};