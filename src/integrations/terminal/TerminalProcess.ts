import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"
import * as vscode from "vscode"
import { logger } from "../../utils/logging"

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
		powershell: [">", "PS>", "PS❯", "PWD>"],
		cmd: [">", "C:\\>", "D:\\>"],
		generic: ["$", ">", "#", "❯", "→", "➜"],
	}

	private static readonly MAX_OUTPUT_LENGTH = 1000000 // 1MB 限制
	private static readonly MAX_OUTPUT_PREVIEW_LENGTH = 100000 // 预览长度限制

	async run(terminal: vscode.Terminal, command: string) {
		this.command = command
		const commandPreview = command.length > 30 ? command.substring(0, 30) + "..." : command
		logger.debug("开始执行命令", {
			ctx: "terminal",
			command: commandPreview,
			fullCommand: command,
			hasShellIntegration: !!terminal.shellIntegration,
			hasExecuteCommand: !!terminal.shellIntegration?.executeCommand,
			terminalType: terminal.name, // 终端类型（如 bash, zsh 等）
		})
		try {
			if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
				logger.debug("使用 shellIntegration 执行命令", {
					ctx: "terminal",
					terminalName: terminal.name,
					hasShellIntegration: !!terminal.shellIntegration,
					hasExecuteCommand: !!terminal.shellIntegration?.executeCommand,
				})
				const execution = terminal.shellIntegration.executeCommand(command)
				const stream = execution.read()
				let isFirstChunk = true
				let didOutputNonCommand = false
				let didEmitEmptyLine = false
				this.fullOutput = "" // 重置输出

				for await (let data of stream) {
					// 检查数据大小
					if (this.fullOutput.length + data.length > TerminalProcess.MAX_OUTPUT_LENGTH) {
						logger.warn("命令输出超过限制", {
							ctx: "terminal",
							currentLength: this.fullOutput.length,
							newDataLength: data.length,
							limit: TerminalProcess.MAX_OUTPUT_LENGTH,
						})

						// 发送截断警告
						this.emit(
							"line",
							"\n... [输出内容过长，已截断。建议使用其他工具查看完整输出，" +
								"比如将输出重定向到文件：command > output.txt]",
						)
						break
					}

					const dataPreview = data.length > 30 ? data.substring(0, 30) + "..." : data
					logger.debug("收到命令输出块", {
						ctx: "terminal",
						length: data.length,
						preview: dataPreview,
						isFirstChunk,
						hasNonCommand: didOutputNonCommand,
					})
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

				logger.debug("命令执行完成", {
					ctx: "terminal",
					totalOutputLength: this.fullOutput.length,
					lastRetrievedIndex: this.lastRetrievedIndex,
				})

				this.emitRemainingBufferIfListening()
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
				}
				this.isHot = false
				this.emit("completed")
				this.emit("continue")
			} else {
				// 记录为什么不能使用 Shell Integration
				logger.debug("无法使用 shellIntegration", {
					ctx: "terminal",
					reason: !terminal.shellIntegration ? "Shell Integration 未启用" : "executeCommand 方法不可用",
					terminalName: terminal.name,
					commandType: this.getCommandType(command),
				})
				// 传统方式
				logger.debug("使用传统方式执行命令", { ctx: "terminal" })
				this.fullOutput = ""
				this.buffer = ""
				this.outputBuffer = []

				// 发送命令
				terminal.sendText(command, true)
				await new Promise((resolve) => setTimeout(resolve, 100))

				// 使用改进后的方法获取输出
				const output = await this.waitForCommandCompletion()
				if (output) {
					// 检查输出大小
					if (output.length > TerminalProcess.MAX_OUTPUT_LENGTH) {
						logger.warn("命令输出超过限制", {
							ctx: "terminal",
							length: output.length,
							limit: TerminalProcess.MAX_OUTPUT_LENGTH,
						})

						const truncatedOutput =
							output.substring(0, TerminalProcess.MAX_OUTPUT_PREVIEW_LENGTH) +
							"\n\n... [输出内容过长，已截断。建议使用其他工具查看完整输出，" +
							"比如将输出重定向到文件：command > output.txt]"

						this.emit("line", "")
						this.emit("line", truncatedOutput)
					} else {
						this.emit("line", "")
						this.processOutput(output)
					}
				}

				this.emit("no_shell_integration")
				this.emit("completed")
				this.emit("continue")
			}
		} catch (error) {
			logger.error("命令执行失败", {
				ctx: "terminal",
				error: error instanceof Error ? error : new Error(String(error)),
			})
			this.emit("error", error instanceof Error ? error : new Error(String(error)))
		}
	}

	private async waitForCommandCompletion(): Promise<string> {
		let output = ""
		let lastOutput = ""
		let attemptCount = 0
		let stableCount = 0
		let waitTime = TerminalProcess.OUTPUT_CHECK_CONFIG.minWaitMs

		logger.debug("开始等待命令完成", {
			ctx: "terminal",
			command: this.command.length > 30 ? this.command.substring(0, 30) + "..." : this.command,
			maxAttempts: TerminalProcess.OUTPUT_CHECK_CONFIG.maxAttempts,
			initialWaitTime: waitTime,
		})

		await new Promise((resolve) => setTimeout(resolve, 200))

		while (attemptCount < TerminalProcess.OUTPUT_CHECK_CONFIG.maxAttempts) {
			try {
				const newOutput = await TerminalProcess.getTerminalContents()

				// 如果检测到提示符，立即返回结果
				if (newOutput && this.checkCommandCompletion(newOutput)) {
					logger.debug("检测到提示符，命令执行完成", {
						ctx: "terminal",
						attempt: attemptCount + 1,
					})
					return newOutput
				}

				const outputPreview = newOutput?.length > 30 ? newOutput.substring(0, 30) + "..." : newOutput
				logger.debug("轮询检查输出", {
					ctx: "terminal",
					attempt: attemptCount + 1,
					hasNewOutput: !!newOutput,
					outputLength: newOutput?.length || 0,
					preview: outputPreview,
					waitTime,
					stableCount,
				})

				if (newOutput) {
					if (newOutput !== lastOutput) {
						output = newOutput
						lastOutput = newOutput
						stableCount = 0

						if (this.isCompiling(newOutput)) {
							waitTime = Math.min(500, waitTime * 1.5)
						} else {
							waitTime = TerminalProcess.OUTPUT_CHECK_CONFIG.minWaitMs
						}
					} else {
						stableCount++
					}
				}

				attemptCount++
				await new Promise((resolve) => setTimeout(resolve, waitTime))
			} catch (error) {
				logger.error("获取终端内容失败", {
					ctx: "terminal",
					error: error instanceof Error ? error.message : String(error),
				})
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
		let content = ""

		try {
			// 保存原始剪贴板内容
			originalClipboard = await vscode.env.clipboard.readText()

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				try {
					// 清除现有选择
					await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")
					await new Promise((resolve) => setTimeout(resolve, 50))

					// 使用 selectToPreviousCommand 只选择最后一个命令的输出
					await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
					await new Promise((resolve) => setTimeout(resolve, 200))

					// 复制选中内容
					await vscode.commands.executeCommand("workbench.action.terminal.copySelection")
					await new Promise((resolve) => setTimeout(resolve, 200))

					// 获取复制的内容
					const newContent = await vscode.env.clipboard.readText()

					// 清除选择
					await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

					if (newContent && newContent !== originalClipboard) {
						content = newContent

						// 检查内容长度
						if (content.length > TerminalProcess.MAX_OUTPUT_LENGTH) {
							logger.warn("终端输出超过限制", {
								ctx: "terminal",
								length: content.length,
								limit: TerminalProcess.MAX_OUTPUT_LENGTH,
							})

							// 截取内容并添加警告信息
							content =
								content.substring(0, TerminalProcess.MAX_OUTPUT_PREVIEW_LENGTH) +
								"\n\n... [输出内容过长，已截断。建议使用其他工具查看完整输出，" +
								"比如将输出重定向到文件：command > output.txt]\n"
							break
						}

						return content
					}

					if (attempt < maxRetries - 1) {
						await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 200))
						continue
					}
				} catch (error) {
					logger.error("获取终端内容失败", {
						ctx: "terminal",
						attempt: attempt + 1,
						error: error instanceof Error ? error.message : String(error),
					})
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

			return content || ""
		} finally {
			// 恢复原始剪贴板内容
			if (originalClipboard !== undefined) {
				try {
					await vscode.env.clipboard.writeText(originalClipboard)
				} catch (error) {
					logger.error("恢复剪贴板失败", {
						ctx: "terminal",
						error: error instanceof Error ? error.message : String(error),
					})
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

		// 从后向前查找第一个非空行
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i].trim()
			if (line) {
				// 找到第一个非空行，检查是否是提示符
				return this.isPromptLine(line)
			}
		}

		return false
	}

	private isPromptLine(line: string): boolean {
		if (!line) return false

		// 检查是否是常见的 shell 提示符
		const hasPrompt = Object.values(TerminalProcess.SHELL_PROMPTS)
			.flat()
			.some((prompt) => {
				return line.endsWith(prompt) || line.endsWith(` ${prompt}`) || line === prompt
			})

		// 检查 macOS zsh 格式
		const hasMacZshPrompt = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+\s+[a-zA-Z0-9_/.-]+\s+[%$#>❯]/.test(line)

		// 检查 Linux/Unix 格式 (支持更多格式)
		const hasUnixPrompt = [
			// username@hostname:~/path$
			/^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+:[~\w/.-]+[$#%>❯]/,
			// [username@hostname path]$
			/^\[[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+\s+[~\w/.-]+\][$#%>❯]/,
			// username@hostname ~/path$
			/^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+\s+[~\w/.-]+[$#%>❯]/,
		].some((pattern) => pattern.test(line))

		// 检查 PowerShell 格式 (支持更多格式)
		const hasPowerShellPrompt = [
			// PS C:\path>
			/^PS\s+[A-Z]:\\[^>]*>/,
			// PS /Users/path>
			/^PS\s+\/[^>]*>/,
			// username@hostname /path>
			/^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+\s+\/[^>]*>/,
		].some((pattern) => pattern.test(line))

		// 检查 Windows CMD 格式
		const hasWindowsPrompt = /^[A-Z]:\\[^>]*>/.test(line)

		// 检查 Fish shell 格式
		const hasFishPrompt = [
			// username@hostname ~/path>
			/^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+\s+~?\/[^>]*[›>❯→]/,
			// ~/path>
			/^~?\/[^>]*[›>❯→]/,
		].some((pattern) => pattern.test(line))

		return hasPrompt || hasMacZshPrompt || hasUnixPrompt || hasPowerShellPrompt || hasWindowsPrompt || hasFishPrompt
	}

	private processOutput(output: string): void {
		if (!output) return

		try {
			const normalizedOutput = this.normalizeLineEndings(output)
			const lines = normalizedOutput.split("\n")

			// 寻找第一个提示符的位置
			let firstPromptIndex = -1
			for (let i = 0; i < lines.length; i++) {
				if (this.isPromptLine(lines[i].trim())) {
					firstPromptIndex = i
					break
				}
			}

			// 如果找到提示符，从提示符开始处理
			if (firstPromptIndex !== -1) {
				// 寻找最后一个提示符的位置
				let lastPromptIndex = -1
				for (let i = lines.length - 1; i > firstPromptIndex; i--) {
					if (this.isPromptLine(lines[i].trim())) {
						lastPromptIndex = i
						break
					}
				}

				// 获取相关行（从第一个提示符到最后一个提示符之间的内容）
				const relevantLines =
					lastPromptIndex !== -1
						? lines.slice(firstPromptIndex, lastPromptIndex)
						: lines.slice(firstPromptIndex)

				// 清理和过滤输出行
				const cleanedLines = relevantLines
					.map((line) => this.cleanLine(line))
					.filter((line) => {
						return (
							line && !this.isCommandEcho(line) && !this.isPromptLine(line) && !this.isSystemPrompt(line)
						)
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

	// 添加辅助方法来分析命令类型
	private getCommandType(command: string): string {
		if (command.includes("|")) return "pipe"
		if (command.includes(">") || command.includes("<")) return "redirect"
		if (command.includes("&&") || command.includes("||")) return "conditional"
		if (command.includes(";")) return "multiple"
		if (command.startsWith("sudo ")) return "sudo"
		return "simple"
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
