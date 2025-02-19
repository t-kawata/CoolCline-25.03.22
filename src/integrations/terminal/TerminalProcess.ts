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

	private static readonly OUTPUT_CHECK_CONFIG = {
		maxAttempts: 30,
		intervalMs: 100,
		minWaitMs: 100,
		maxWaitMs: 2000,
		stableCount: 3,
	}

	private static readonly SHELL_PROMPTS = {
		zsh: ["%", "$", "➜", "❯"],
		bash: ["$", "#", "@", "❯"],
		fish: ["›", "$", "❯", "→"],
		powershell: [">", "PS>", "PS❯", "PWD>"],
		cmd: [">", "C:\\>", "D:\\>"],
		generic: ["$", ">", "#", "❯", "→", "➜"],
	}

	private static readonly MAX_OUTPUT_LENGTH = 1000000
	private static readonly MAX_OUTPUT_PREVIEW_LENGTH = 100000

	// 为测试添加的方法
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

	private removeLastLineArtifacts(output: string): string {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}

	continue() {
		this.emitRemainingBufferIfListening()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	async run(terminal: vscode.Terminal, command: string) {
		this.command = command
		this.isHot = true
		const commandPreview = command.length > 30 ? command.substring(0, 30) + "..." : command

		try {
			const shellIntegration = (terminal as any).shellIntegration
			const hasExecuteCommand = typeof shellIntegration?.executeCommand === "function"

			if (hasExecuteCommand) {
				// 使用 shell integration
				// console.log("[DEBUG] 使用 shell integration 执行命令:", command)
				const execution = shellIntegration.executeCommand(command)
				const stream = execution.read()

				this.fullOutput = ""
				// console.log("[DEBUG] 开始读取流")

				// 创建一个 Promise 来等待命令执行完成
				const exitCodePromise = execution.exitCode

				// 读取输出流
				for await (const chunk of stream) {
					// console.log("[DEBUG] 收到 chunk:", chunk)
					if (chunk) {
						console.log("[DEBUG] 处理 chunk，长度:", chunk.length)
						this.processOutput(chunk)
					}
				}
				console.log("[DEBUG] 流读取完成")

				// 等待命令执行完成
				const exitCode = await exitCodePromise
				console.log("[DEBUG] 命令执行完成，退出码:", exitCode)

				// 获取最终输出
				const finalOutput = await this.getTerminalContents()
				if (finalOutput) {
					console.log("[DEBUG] 获取到最终输出:", finalOutput)
					// 只处理新的输出部分
					const lines = finalOutput.split("\n")
					const commandIndex = lines.findIndex((line) => line.includes(this.command))
					if (commandIndex !== -1 && commandIndex < lines.length - 1) {
						const newOutput = lines.slice(commandIndex + 1).join("\n")
						console.log("[DEBUG] 提取的新输出:", newOutput)
						this.processOutput(newOutput)
					}
				}

				// 命令执行完成
				this.emit("completed")
				this.emit("continue")
			} else {
				// 使用传统方式
				logger.debug("使用传统方式执行命令", {
					ctx: "terminal",
					command: commandPreview,
				})

				// 触发 no_shell_integration 事件
				this.emit("no_shell_integration")

				this.fullOutput = ""
				this.buffer = ""
				this.outputBuffer = []

				// 发送命令
				terminal.sendText(command, true)
				await new Promise((resolve) => setTimeout(resolve, 100))

				// 等待命令完成
				const output = await this.waitForCommandCompletion()
				if (output) {
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

				this.emit("completed")
				this.emit("continue")
			}
		} catch (error) {
			logger.error("命令执行失败", {
				ctx: "terminal",
				error: error instanceof Error ? error : new Error(String(error)),
			})
			this.emit("error", error instanceof Error ? error : new Error(String(error)))
		} finally {
			this.isHot = false
		}
	}

	private processOutput(output: string) {
		console.log("[DEBUG] processOutput 开始处理输出:", output)
		// 移除 ANSI 转义序列
		const cleanOutput = stripAnsi(output)
		console.log("[DEBUG] 清理后的输出:", cleanOutput)

		// 过滤掉 shell integration 的控制序列和命令行
		const lines = cleanOutput
			.split("\n")
			.map((line) => {
				return line
					.replace(/\[(\?2004[hl]|K)\]/g, "") // 移除终端控制序列
					.replace(/\]633;[^]*?\\/g, "") // 移除 shell integration 序列
					.replace(/^n/, "") // 移除开头的 n
					.trim()
			})
			.filter((line) => {
				// 过滤掉不需要的行
				if (!line) return false
				if (line.startsWith(";")) return false
				if (line.includes("633;")) return false
				if (line.match(/^[^@]*@[^%]*%/)) return false // 过滤掉提示符行
				if (line === this.command) return false // 过滤掉命令本身
				return true
			})

		console.log("[DEBUG] 过滤后的行:", lines)

		// 更新完整输出
		if (lines.length > 0) {
			this.fullOutput += lines.join("\n") + "\n"
		}

		// 发送每一行
		for (const line of lines) {
			console.log("[DEBUG] 发送行:", line)
			this.emit("line", line)
		}
	}

	private async waitForCommandCompletion(): Promise<string> {
		const config = TerminalProcess.OUTPUT_CHECK_CONFIG
		let lastOutput = ""
		let stableCount = 0
		let attempt = 0

		while (attempt < config.maxAttempts) {
			attempt++
			await new Promise((resolve) => setTimeout(resolve, config.intervalMs))

			const currentOutput = await this.getTerminalContents()
			if (currentOutput === lastOutput) {
				stableCount++
				if (stableCount >= config.stableCount) {
					logger.debug("检测到提示符，命令执行完成", {
						ctx: "terminal",
						attempt,
					})
					return currentOutput
				}
			} else {
				stableCount = 0
				lastOutput = currentOutput
			}
		}

		logger.warn("命令执行超时", {
			ctx: "terminal",
			attempts: attempt,
		})
		return lastOutput
	}

	private async getTerminalContents(): Promise<string> {
		try {
			// 清除当前选择
			await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

			// 选择到上一个命令
			await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")

			// 复制选中内容
			await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

			// 获取复制的内容
			const clipboardContent = await vscode.env.clipboard.readText()

			// 清除选择
			await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

			return clipboardContent
		} catch (error) {
			logger.error("获取终端内容失败", {
				ctx: "terminal",
				error: error instanceof Error ? error : new Error(String(error)),
			})
			return ""
		}
	}

	getUnretrievedOutput(): string {
		const output = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return output
	}
}

export type TerminalProcessResultPromise = Promise<void> & {
	on: (event: string, listener: (...args: any[]) => void) => TerminalProcessResultPromise
	once: (event: string, listener: (...args: any[]) => void) => TerminalProcessResultPromise
	continue: () => void
}

export function mergePromise(process: TerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const resultPromise = promise as TerminalProcessResultPromise
	resultPromise.on = (event: string, listener: (...args: any[]) => void) => {
		process.on(event, listener)
		return resultPromise
	}
	resultPromise.once = (event: string, listener: (...args: any[]) => void) => {
		process.once(event, listener)
		return resultPromise
	}
	resultPromise.continue = () => {
		process.emit("continue")
	}
	return resultPromise
}
