import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, SingleCompletionHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"

export class OllamaHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	// R1 模型的关键字匹配列表
	private static readonly R1_MODEL_KEYWORDS = [
		"deepseek-r1",
		"deepseek_r1",
		"deepseekr1",
		"deepseekreasoner",
		"deepseek-reasoner",
		"deepseek-r1-7b",
		"deepseek-r1-13b",
		"deepseek-r1-70b",
		"deepseek-r1-7b-instruct",
		"deepseek-r1-13b-instruct",
		"deepseek-r1-70b-instruct",
		"deepseek-r1-7b-chat",
		"deepseek-r1-13b-chat",
		"deepseek-r1-70b-chat",
		"deepseek-r1-7b-chat-instruct",
		"deepseek-r1-13b-chat-instruct",
		"deepseek-r1-70b-chat-instruct",
	]

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: (this.options.ollamaBaseUrl || "http://localhost:11434") + "/v1",
			apiKey: "ollama",
		})
	}

	private normalizeModelId(modelId: string): string {
		return (
			modelId
				.toLowerCase()
				// 移除版本号（如 -7b, -13b, -70b 等）
				.replace(/-?\d+b\b/g, "")
				// 移除其他常见后缀
				.replace(/-v\d+(\.\d+)*\b/g, "") // 如 -v1, -v1.0
				.replace(/-chat\b/g, "")
				.replace(/-instruct\b/g, "")
				.replace(/-beta\b/g, "")
				.replace(/-alpha\b/g, "")
				// 移除特殊字符
				.replace(/[-_]/g, "")
				.trim()
		)
	}

	private isR1Model(modelId: string): boolean {
		const normalizedModelId = this.normalizeModelId(modelId)
		const normalizedKeywords = OllamaHandler.R1_MODEL_KEYWORDS.map((k) => this.normalizeModelId(k))

		// 采用宽松的匹配规则：只要包含任一关键字即可
		return normalizedKeywords.some((keyword) => normalizedModelId.includes(keyword))
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.getModel().id
		const useR1Format = this.isR1Model(modelId)

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...(useR1Format ? convertToR1Format(messages) : convertToOpenAiMessages(messages)),
		]

		try {
			const stream = await this.client.chat.completions.create({
				model: modelId,
				messages: openAiMessages,
				temperature: this.options.modelTemperature ?? 0,
				stream: true,
			})
			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}
			}
		} catch (error) {
			// 保持与测试用例兼容的错误处理
			if (error instanceof Error) {
				throw error
			}
			throw new Error("Unknown error occurred")
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.ollamaModelId || "",
			info: openAiModelInfoSaneDefaults,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const modelId = this.getModel().id
			const useR1Format = this.isR1Model(modelId)

			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = useR1Format
				? convertToR1Format([{ role: "user", content: prompt }])
				: [{ role: "user", content: prompt }]

			const response = await this.client.chat.completions.create({
				model: modelId,
				messages,
				temperature: this.options.modelTemperature ?? 0,
				stream: false,
			})
			return response.choices[0]?.message.content || ""
		} catch (error) {
			// 保持与测试用例兼容的错误处理
			if (error instanceof Error) {
				throw new Error(`Ollama completion error: ${error.message}`)
			}
			throw new Error("Unknown error occurred")
		}
	}
}
