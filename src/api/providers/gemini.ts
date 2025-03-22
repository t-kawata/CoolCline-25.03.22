import { Anthropic } from "@anthropic-ai/sdk"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { ApiHandler, SingleCompletionHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "../../shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"
import { GEMINI_DEFAULT_TEMPERATURE } from "./constants"

export class GeminiHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenerativeAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new GoogleGenerativeAI(options.geminiApiKey ?? "gemini-api-key-not-configured")
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		if (this.getModel().id === "gemma-3-27b-it") {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:streamGenerateContent?key=${this.options.geminiApiKey}`
			const requestBody = {
				contents: messages.map(convertAnthropicMessageToGemini),
			}
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
			})

			if (!response.ok) {
				const error = await response.json()
				console.error("Error:", error)
				throw new Error(`HTTP-Error ${response.status}: ${response.statusText}`)
			}

			const reader = response.body?.getReader()
			if (!reader) {
				throw new Error("Empty response body.")
			}

			const decoder = new TextDecoder()
			let done = false
			let usageMetadata = null

			// while (!done) {
			// 	const { value, done: streamDone } = await reader.read()
			// 	done = streamDone
			// 	if (value) {
			// 		const chunk = JSON.parse(decoder.decode(value))
			// 		usageMetadata = chunk.usageMetadata;
			// 		for (const candidate of chunk.candidates) {
			// 			yield {
			// 				type: "text",
			// 				text: candidate.content.parts[0]?.text || ""
			// 			}
			// 		}
			// 	}
			// }
			let buffer = ""
			while (!done) {
				const { value, done: streamDone } = await reader.read()
				done = streamDone
				if (value) {
					buffer += decoder.decode(value, { stream: true }) // ストリームとしてデコード
					let boundary = buffer.indexOf("\n") // 行区切りでデータを分割
					while (boundary !== -1) {
						const chunk = buffer.slice(0, boundary).trim()
						buffer = buffer.slice(boundary + 1)
						boundary = buffer.indexOf("\n")
						if (chunk) {
							try {
								const parsedChunk = JSON.parse(chunk) // JSONとしてパース
								usageMetadata = parsedChunk.usageMetadata
								for (const candidate of parsedChunk.candidates) {
									yield {
										type: "text",
										text: candidate.content.parts[0]?.text || "",
									}
								}
							} catch (error) {
								console.error("Error-JSON-Parse:", error)
							}
						}
					}
				}
			}
			if (usageMetadata) {
				yield {
					type: "usage",
					inputTokens: usageMetadata.promptTokenCount ?? 0,
					outputTokens: usageMetadata.candidatesTokenCount ?? 0,
				}
			}
		} else {
			const model = this.client.getGenerativeModel({
				model: this.getModel().id,
				systemInstruction: systemPrompt,
			})
			const result = await model.generateContentStream({
				contents: messages.map(convertAnthropicMessageToGemini),
				generationConfig: {
					// maxOutputTokens: this.getModel().info.maxTokens,
					temperature: this.options.modelTemperature ?? GEMINI_DEFAULT_TEMPERATURE,
				},
			})

			for await (const chunk of result.stream) {
				yield {
					type: "text",
					text: chunk.text(),
				}
			}

			const response = await result.response
			yield {
				type: "usage",
				inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
				outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
			}
		}
	}

	getModel(): { id: GeminiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}
		return { id: geminiDefaultModelId, info: geminiModels[geminiDefaultModelId] }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			if (this.getModel().id === "gemma-3-27b-it") {
				const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${this.options.geminiApiKey}`
				const requestBody = {
					contents: [{ role: "user", parts: [{ text: prompt }] }],
				}

				const response = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(requestBody),
				})

				if (!response.ok) {
					const error = await response.json()
					console.error("Error:", error)
					throw new Error(`HTTP-Error ${response.status}: ${response.statusText}`)
				}

				const data = await response.json()

				const candidate = data.candidates?.[0]?.content.parts?.[0]?.text
				if (!candidate) {
					throw new Error("No valid text found in candidate.")
				}
				return candidate
			} else {
				const model = this.client.getGenerativeModel({
					model: this.getModel().id,
				})

				const result = await model.generateContent({
					contents: [{ role: "user", parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: this.options.modelTemperature ?? GEMINI_DEFAULT_TEMPERATURE,
					},
				})

				return result.response.text()
			}
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Gemini completion error: ${error.message}`)
			}
			throw error
		}
	}
}

// 25.03.22 Kawata gemma-3-27b-it を使用可能にするために class 自体を書き換える
// export class GeminiHandler implements ApiHandler, SingleCompletionHandler {
// 	private options: ApiHandlerOptions
// 	private client: GoogleGenerativeAI

// 	constructor(options: ApiHandlerOptions) {
// 		this.options = options
// 		this.client = new GoogleGenerativeAI(options.geminiApiKey ?? "gemini-api-key-not-configured")
// 	}

// 	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
// 		const model = this.client.getGenerativeModel({
// 			model: this.getModel().id,
// 			systemInstruction: systemPrompt,
// 		})
// 		const result = await model.generateContentStream({
// 			contents: messages.map(convertAnthropicMessageToGemini),
// 			generationConfig: {
// 				// maxOutputTokens: this.getModel().info.maxTokens,
// 				temperature: this.options.modelTemperature ?? GEMINI_DEFAULT_TEMPERATURE,
// 			},
// 		})

// 		for await (const chunk of result.stream) {
// 			yield {
// 				type: "text",
// 				text: chunk.text(),
// 			}
// 		}

// 		const response = await result.response
// 		yield {
// 			type: "usage",
// 			inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
// 			outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
// 		}
// 	}

// 	getModel(): { id: GeminiModelId; info: ModelInfo } {
// 		const modelId = this.options.apiModelId
// 		if (modelId && modelId in geminiModels) {
// 			const id = modelId as GeminiModelId
// 			return { id, info: geminiModels[id] }
// 		}
// 		return { id: geminiDefaultModelId, info: geminiModels[geminiDefaultModelId] }
// 	}

// 	async completePrompt(prompt: string): Promise<string> {
// 		try {
// 			const model = this.client.getGenerativeModel({
// 				model: this.getModel().id,
// 			})

// 			const result = await model.generateContent({
// 				contents: [{ role: "user", parts: [{ text: prompt }] }],
// 				generationConfig: {
// 					temperature: this.options.modelTemperature ?? GEMINI_DEFAULT_TEMPERATURE,
// 				},
// 			})

// 			return result.response.text()
// 		} catch (error) {
// 			if (error instanceof Error) {
// 				throw new Error(`Gemini completion error: ${error.message}`)
// 			}
// 			throw error
// 		}
// 	}
// }
