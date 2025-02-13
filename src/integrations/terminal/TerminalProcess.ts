import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"
import * as vscode from "vscode"

const PROCESS_HOT_TIMEOUT_NORMAL = 2_000
const PROCESS_HOT_TIMEOUT_COMPILING = 15_000

export class TerminalProcess extends EventEmitter {
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	isHot: boolean = false
	private hotTimer: NodeJS.Timeout | null = null
	private command: string = ""
	private outputBuffer: string[] = []
	private lastPromptIndex: number = -1

	private static readonly SHELL_INTEGRATION_TIMEOUT = 5000 // 5 seconds timeout for shell integration
	private static readonly OUTPUT_CHECK_CONFIG = {
		maxAttempts: 30, // 增加最大尝试次数
		intervalMs: 100,
		minWaitMs: 100,
		maxWaitMs: 2000,
		stableCount: 3, // 需要连续几次输出稳定才认为命令执行完成
	}

	private static readonly SHELL_PROMPTS = {
		zsh: ["%", "$", "➜", "❯"],
		bash: ["$", "#", "@", "❯"],
		fish: ["›", "$", "❯", "→"],
		powershell: [">", "PS>", "PS❯"],
		cmd: [">", "C:\\>", "D:\\>"],
		generic: ["$", ">", "#", "❯", "→", "➜"],
	}

	async run(terminal: vscode.Terminal, command: string) {
		this.command = command
		try {
			if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
				const execution = terminal.shellIntegration.executeCommand(command)
				const stream = execution.read()
				let isFirstChunk = true
				let didOutputNonCommand = false
				let didEmitEmptyLine = false

				for await (let data of stream) {
					if (isFirstChunk) {
						const outputBetweenSequences = this.removeLastLineArtifacts(
							data.match(/\]633;C([\s\S]*?)\]633;D/)?.[1] || "",
						).trim()

						const vscodeSequenceRegex = /\x1b\]633;.[^\x07]*\x07/g
						const lastMatch = [...data.matchAll(vscodeSequenceRegex)].pop()
						if (lastMatch && lastMatch.index !== undefined) {
							data = data.slice(lastMatch.index + lastMatch[0].length)
						}
						if (outputBetweenSequences) {
							data = outputBetweenSequences + "\n" + data
						}
						data = stripAnsi(data)
						let lines = data ? data.split("\n") : []
						if (lines.length > 0) {
							lines[0] = lines[0].replace(/[^\x20-\x7E]/g, "")
							if (lines[0].length >= 2 && lines[0][0] === lines[0][1]) {
								lines[0] = lines[0].slice(1)
							}
							lines[0] = lines[0].replace(/^[^a-zA-Z0-9]*/, "")
						}
						if (lines.length > 1) {
							lines[1] = lines[1].replace(/^[^a-zA-Z0-9]*/, "")
						}
						data = lines.join("\n")
						isFirstChunk = false
					} else {
						data = stripAnsi(data)
					}

					if (!didOutputNonCommand) {
						const lines = data.split("\n")
						for (let i = 0; i < lines.length; i++) {
							if (command.includes(lines[i].trim())) {
								lines.splice(i, 1)
								i--
							} else {
								didOutputNonCommand = true
								break
							}
						}
						data = lines.join("\n")
					}

					data = data.replace(/,/g, "")
					this.isHot = true
					if (this.hotTimer) {
						clearTimeout(this.hotTimer)
					}

					const compilingMarkers = [
						"compiling",
						"building",
						"bundling",
						"transpiling",
						"generating",
						"starting",
					]
					const markerNullifiers = [
						"compiled",
						"success",
						"finish",
						"complete",
						"succeed",
						"done",
						"end",
						"stop",
						"exit",
						"terminate",
						"error",
						"fail",
					]
					const isCompiling =
						compilingMarkers.some((marker) => data.toLowerCase().includes(marker.toLowerCase())) &&
						!markerNullifiers.some((nullifier) => data.toLowerCase().includes(nullifier.toLowerCase()))

					this.hotTimer = setTimeout(
						() => {
							this.isHot = false
						},
						isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL,
					)

					if (!didEmitEmptyLine && !this.fullOutput && data) {
						this.emit("line", "")
						didEmitEmptyLine = true
					}

					this.fullOutput += data
					if (this.isListening) {
						this.emitIfEol(data)
						this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
					}
				}

				this.emitRemainingBufferIfListening()
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
				}
				this.isHot = false
				this.emit("completed")
				this.emit("continue")
			} else {
				this.fullOutput = ""
				this.buffer = ""
				this.outputBuffer = []

				// 先发送命令，让命令开始执行
				terminal.sendText(command, true)

				// 等待一小段时间让命令开始执行
				await new Promise((resolve) => setTimeout(resolve, 100))

				// 尝试获取输出
				const output = await this.waitForCommandCompletion()
				if (output) {
					// 处理输出前发出开始信号
					this.emit("line", "")
					this.processOutput(output)
				}

				this.isHot = false
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
				}

				this.emit("no_shell_integration")
				this.emit("completed")
				this.emit("continue")
			}
		} catch (error) {
			console.error(`Error executing command in terminal: ${error}`)
			this.emit("error", error instanceof Error ? error : new Error(String(error)))
		}
	}

	private async waitForCommandCompletion(): Promise<string> {
		let output = ""
		let lastOutput = ""
		let attemptCount = 0
		let stableCount = 0
		let waitTime = TerminalProcess.OUTPUT_CHECK_CONFIG.minWaitMs

		// 给命令执行一些初始时间
		await new Promise((resolve) => setTimeout(resolve, 200))

		while (attemptCount < TerminalProcess.OUTPUT_CHECK_CONFIG.maxAttempts) {
			try {
				const newOutput = await TerminalProcess.getTerminalContents()

				if (newOutput) {
					if (newOutput !== lastOutput) {
						output = newOutput
						lastOutput = newOutput
						stableCount = 0

						// 动态调整等待时间
						if (this.isCompiling(newOutput)) {
							waitTime = Math.min(500, waitTime * 1.5)
						} else {
							waitTime = TerminalProcess.OUTPUT_CHECK_CONFIG.minWaitMs
						}
					} else {
						stableCount++
						if (stableCount >= TerminalProcess.OUTPUT_CHECK_CONFIG.stableCount) {
							// 在认为命令完成之前，再次检查最后一次输出
							await new Promise((resolve) => setTimeout(resolve, 100))
							const finalCheck = await TerminalProcess.getTerminalContents()
							if (finalCheck === output && this.checkCommandCompletion(finalCheck)) {
								return output
							}
						}
					}
				}

				attemptCount++
				await new Promise((resolve) => setTimeout(resolve, waitTime))
			} catch (error) {
				console.error("Failed to get terminal contents:", error)
				attemptCount++
				waitTime = Math.min(waitTime * 1.5, TerminalProcess.OUTPUT_CHECK_CONFIG.maxWaitMs)
			}
		}

		return output
	}

	static async getTerminalContents(commands = -1): Promise<string> {
		const maxRetries = 3
		let lastError: Error | undefined
		let originalClipboard: string | undefined

		try {
			// 首先保存原始剪贴板内容
			originalClipboard = await vscode.env.clipboard.readText()

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				try {
					// 确保清除任何现有选择
					await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")
					await new Promise((resolve) => setTimeout(resolve, 50))

					// 根据参数选择不同的选择策略
					if (commands < 0) {
						await vscode.commands.executeCommand("workbench.action.terminal.selectAll")
					} else {
						await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
					}

					// 给足够的时间让选择完成
					await new Promise((resolve) => setTimeout(resolve, 150))

					// 复制选中内容到剪贴板
					await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

					// 确保复制操作完成
					await new Promise((resolve) => setTimeout(resolve, 150))

					// 获取复制的内容
					const content = await vscode.env.clipboard.readText()

					// 立即清除选择避免影响视觉
					await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

					// 如果获取到了新内容
					if (content && content !== originalClipboard) {
						return content
					}

					// 如果还有重试机会，等待后重试
					if (attempt < maxRetries - 1) {
						await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 200))
						continue
					}
				} catch (error) {
					console.error(`Terminal content retrieval attempt ${attempt + 1} failed:`, error)
					lastError = error instanceof Error ? error : new Error(String(error))

					if (attempt < maxRetries - 1) {
						await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 200))
						continue
					}
				}
			}

			if (lastError) {
				throw lastError
			}

			return ""
		} finally {
			// 确保在所有情况下都恢复原始剪贴板内容
			if (originalClipboard !== undefined) {
				try {
					await vscode.env.clipboard.writeText(originalClipboard)
				} catch (error) {
					console.error("Failed to restore clipboard:", error)
				}
			}
		}
	}

	private isCompiling(output: string): boolean {
		const compilingMarkers = ["compiling", "building", "bundling", "transpiling", "generating", "starting"]
		const markerNullifiers = [
			"compiled",
			"success",
			"finish",
			"complete",
			"succeed",
			"done",
			"end",
			"stop",
			"exit",
			"terminate",
			"error",
			"fail",
		]

		const lowerOutput = output.toLowerCase()
		return (
			compilingMarkers.some((marker) => lowerOutput.includes(marker)) &&
			!markerNullifiers.some((nullifier) => lowerOutput.includes(nullifier))
		)
	}

	private checkCommandCompletion(data: string): boolean {
		if (!data) return false

		const lines = data.split("\n")
		const lastLine = lines[lines.length - 1].trim()

		// 如果最后一行是空的，检查倒数第二行
		if (!lastLine && lines.length > 1) {
			const secondLastLine = lines[lines.length - 2].trim()
			if (this.isPromptLine(secondLastLine)) {
				return true
			}
		}

		return this.isPromptLine(lastLine)
	}

	private isPromptLine(line: string): boolean {
		if (!line) return false

		// 检查是否是常见的 shell 提示符
		const hasPrompt = Object.values(TerminalProcess.SHELL_PROMPTS)
			.flat()
			.some((prompt) => {
				// 添加更多提示符模式的检查
				return line.endsWith(prompt) || line.endsWith(` ${prompt}`) || line === prompt
			})

		// 检查常见的用户@主机格式
		const hasUserHostPrompt = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+:[~\w/.-]+[$#%>❯]/.test(line)

		// 检查 Windows 路径格式
		const hasWindowsPathPrompt = /^[A-Z]:\\[^>]*>/.test(line)

		// 检查 Git bash 风格的提示符
		const hasGitBashPrompt = /^[A-Z]:[\w\s/\\-]+[$#>❯]/.test(line)

		return hasPrompt || hasUserHostPrompt || hasWindowsPathPrompt || hasGitBashPrompt
	}

	private processOutput(output: string): void {
		if (!output) return

		try {
			const normalizedOutput = this.normalizeLineEndings(output)
			const lines = normalizedOutput.split("\n")

			// 寻找最后一个提示符的位置
			let lastPromptIndex = -1
			for (let i = lines.length - 1; i >= 0; i--) {
				if (this.isPromptLine(lines[i].trim())) {
					lastPromptIndex = i
					break
				}
			}

			// 获取相关行
			const relevantLines = lastPromptIndex !== -1 ? lines.slice(0, lastPromptIndex) : lines

			// 清理和过滤输出行
			const cleanedLines = relevantLines
				.map((line) => this.cleanLine(line))
				.filter((line) => {
					return line && !this.isCommandEcho(line) && !this.isPromptLine(line) && !this.isSystemPrompt(line)
				})

			// 如果有新的输出内容
			if (cleanedLines.length > 0) {
				const processedOutput = cleanedLines.join("\n")
				if (!this.outputBuffer.includes(processedOutput)) {
					this.outputBuffer.push(processedOutput)
					this.fullOutput = this.outputBuffer.join("\n")
					this.emit("line", processedOutput)
				}
			}
		} catch (error) {
			console.error("Error processing output:", error)
			this.emit("error", error instanceof Error ? error : new Error(String(error)))
		}
	}

	private isSystemPrompt(line: string): boolean {
		const systemPrompts = [
			/^\[Press ENTER to continue\]$/i,
			/^Press any key to continue\.\.\./i,
			/^More\?\s*$/i,
			/^\(END\)\s*$/i,
			/^--More--$/i,
		]

		return systemPrompts.some((pattern) => pattern.test(line.trim()))
	}

	private cleanLine(line: string): string {
		return line
			.replace(/^\s*[\$%>#]\s*/, "")
			.replace(/[\$%>#]\s*$/, "")
			.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
			.replace(/[\x00-\x1F\x7F]/g, "")
			.trim()
	}

	private isCommandEcho(line: string): boolean {
		if (!this.command) return false

		const normalizedLine = line.trim().toLowerCase()
		const normalizedCommand = this.command.trim().toLowerCase()

		return (
			normalizedLine === normalizedCommand ||
			normalizedLine === `$ ${normalizedCommand}` ||
			normalizedLine === `> ${normalizedCommand}` ||
			normalizedLine === `# ${normalizedCommand}` ||
			normalizedLine.startsWith(`${normalizedCommand} `) ||
			normalizedLine.endsWith(` ${normalizedCommand}`) ||
			Object.values(TerminalProcess.SHELL_PROMPTS)
				.flat()
				.some(
					(prompt) =>
						normalizedLine === `${prompt} ${normalizedCommand}` ||
						normalizedLine.endsWith(`${prompt} ${normalizedCommand}`),
				)
		)
	}

	private normalizeLineEndings(output: string): string {
		return output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n\n+/g, "\n").trim()
	}

	private emitIfEol(chunk: string) {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			let line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	private emitRemainingBufferIfListening() {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	continue() {
		this.emitRemainingBufferIfListening()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return this.removeLastLineArtifacts(unretrieved)
	}

	private removeLastLineArtifacts(output: string): string {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}
}

// Similar to execa's ResultPromise, this lets us create a mixin of both a TerminalProcess and a Promise
export function mergePromise(process: TerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const nativePromisePrototype = (async () => {})().constructor.prototype
	const descriptors = ["then", "catch", "finally"].map(
		(property) => [property, Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)] as const,
	)

	for (const [property, descriptor] of descriptors) {
		if (descriptor) {
			const value = descriptor.value.bind(promise)
			Reflect.defineProperty(process, property, { ...descriptor, value })
		}
	}

	return process as TerminalProcessResultPromise
}

export type TerminalProcessResultPromise = TerminalProcess & Promise<void>
