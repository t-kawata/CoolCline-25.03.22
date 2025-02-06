import { truncateHalfConversation, getTruncFractionForNonPromptCachingModels } from "../index"
import { ModelInfo } from "../../../shared/api"

describe("getTruncFractionForNonPromptCachingModels", () => {
	it("should return 0.2 for models with small context window", () => {
		const modelInfo: ModelInfo = {
			contextWindow: 100_000,
			maxTokens: 4096,
			supportsPromptCache: false,
		}
		expect(getTruncFractionForNonPromptCachingModels(modelInfo)).toBe(0.2)
	})

	it("should return calculated fraction for models with large context window", () => {
		const modelInfo: ModelInfo = {
			contextWindow: 400_000,
			maxTokens: 8192,
			supportsPromptCache: false,
		}
		expect(getTruncFractionForNonPromptCachingModels(modelInfo)).toBe(0.1)
	})
})
