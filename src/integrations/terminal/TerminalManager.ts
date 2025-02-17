import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
import { arePathsEqual } from "../../utils/path"
import { mergePromise, TerminalProcess, TerminalProcessResultPromise } from "./TerminalProcess"
import { TerminalInfo, TerminalRegistry } from "./TerminalRegistry"
import { logger } from "../../utils/logging"

/*
TerminalManager:
- Creates/reuses terminals
- Runs commands via runCommand(), returning a TerminalProcess
- Handles shell integration events

TerminalProcess extends EventEmitter and implements Promise:
- Emits 'line' events with output while promise is pending
- process.continue() resolves promise and stops event emission
- Allows real-time output handling or background execution

getUnretrievedOutput() fetches latest output for ongoing commands

Enables flexible command execution:
- Await for completion
- Listen to real-time events
- Continue execution in background
- Retrieve missed output later

Notes:
- it turns out some shellIntegration APIs are available on cursor, although not on older versions of vscode
- "By default, the shell integration script should automatically activate on supported shells launched from VS Code."
Supported shells:
Linux/macOS: bash, fish, pwsh, zsh
Windows: pwsh


Example:

const terminalManager = new TerminalManager(context);

// Run a command
const process = terminalManager.runCommand('npm install', '/path/to/project');

process.on('line', (line) => {
    console.log(line);
});

// To wait for the process to complete naturally:
await process;

// Or to continue execution even if the command is still running:
process.continue();

// Later, if you need to get the unretrieved output:
const unretrievedOutput = terminalManager.getUnretrievedOutput(terminalId);
console.log('Unretrieved output:', unretrievedOutput);

Resources:
- https://github.com/microsoft/vscode/issues/226655
- https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api
- https://code.visualstudio.com/docs/terminal/shell-integration
- https://code.visualstudio.com/api/references/vscode-api#Terminal
- https://github.com/microsoft/vscode-extension-samples/blob/main/terminal-sample/src/extension.ts
- https://github.com/microsoft/vscode-extension-samples/blob/main/shell-integration-sample/src/extension.ts
*/

/*
The new shellIntegration API gives us access to terminal command execution output handling.
However, we don't update our VSCode type definitions or engine requirements to maintain compatibility
with older VSCode versions. Users on older versions will automatically fall back to using sendText
for terminal command execution.
Interestingly, some environments like Cursor enable these APIs even without the latest VSCode engine.
This approach allows us to leverage advanced features when available while ensuring broad compatibility.
*/
declare module "vscode" {
	// https://github.com/microsoft/vscode/blob/f0417069c62e20f3667506f4b7e53ca0004b4e3e/src/vscode-dts/vscode.d.ts#L10794
	interface Window {
		onDidStartTerminalShellExecution?: (
			listener: (e: any) => any,
			thisArgs?: any,
			disposables?: vscode.Disposable[],
		) => vscode.Disposable
	}
}

// Extend the Terminal type to include our custom properties
interface TerminalShellIntegration {
	readonly cwd?: vscode.Uri
	readonly executeCommand?: (command: string) => {
		read: () => AsyncIterable<string>
	}
}

type ExtendedTerminal = vscode.Terminal & {
	readonly shellIntegration?: TerminalShellIntegration
}

export class TerminalManager {
	private terminalIds: Set<number> = new Set()
	private processes: Map<number, TerminalProcess> = new Map()
	private disposables: vscode.Disposable[] = []

	constructor() {
		let disposable: vscode.Disposable | undefined
		try {
			// 尝试注册 shell execution 事件监听
			disposable = (vscode.window as vscode.Window).onDidStartTerminalShellExecution?.(async (e) => {
				if (e?.execution?.read) {
					// 创建读取流以确保更一致的输出
					e.execution.read()
					logger.debug("Shell integration 事件监听已注册", {
						ctx: "terminal",
						hasRead: !!e.execution.read,
						event: e,
					})
				}
			})
		} catch (error) {
			logger.warn("Shell integration 事件监听注册失败", {
				ctx: "terminal",
				error: error instanceof Error ? error.message : String(error),
			})
		}
		if (disposable) {
			this.disposables.push(disposable)
		}
	}

	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command
		const process = new TerminalProcess()
		this.processes.set(terminalInfo.id, process)

		process.once("completed", () => {
			terminalInfo.busy = false
		})

		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => {
				resolve()
			})
			process.once("error", (error) => {
				logger.error(`终端 ${terminalInfo.id} 执行出错:`, {
					ctx: "terminal",
					error: error instanceof Error ? error.message : String(error),
				})
				reject(error)
			})
		})

		const terminal = terminalInfo.terminal as ExtendedTerminal
		// 检查 shell integration 支持
		const hasShellIntegration = !!terminal.shellIntegration?.executeCommand
		logger.debug("检查 shell integration 支持", {
			ctx: "terminal",
			hasShellIntegration,
			terminalName: terminal.name,
			shellIntegration: terminal.shellIntegration,
			executeCommand: !!terminal.shellIntegration?.executeCommand,
			terminal: terminal,
		})

		process.run(terminal, command)
		return mergePromise(process, promise)
	}

	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		const terminals = TerminalRegistry.getAllTerminals()

		// Find available terminal from our pool first (created for this task)
		const matchingTerminal = terminals.find((t) => {
			if (t.busy) {
				return false
			}
			const terminal = t.terminal as ExtendedTerminal
			const terminalCwd = terminal.shellIntegration?.cwd // one of coolcline's commands could have changed the cwd of the terminal
			if (!terminalCwd) {
				return false
			}
			return arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd.fsPath)
		})
		if (matchingTerminal) {
			this.terminalIds.add(matchingTerminal.id)
			return matchingTerminal
		}

		// If no matching terminal exists, try to find any non-busy terminal
		const availableTerminal = terminals.find((t) => !t.busy)
		if (availableTerminal) {
			// Navigate back to the desired directory
			await this.runCommand(availableTerminal, `cd "${cwd}"`)
			this.terminalIds.add(availableTerminal.id)
			return availableTerminal
		}

		// If all terminals are busy, create a new one
		const newTerminalInfo = await TerminalRegistry.createTerminal(cwd)
		this.terminalIds.add(newTerminalInfo.id)
		return newTerminalInfo
	}

	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		return Array.from(this.terminalIds)
			.map((id) => TerminalRegistry.getTerminal(id))
			.filter((t): t is TerminalInfo => t !== undefined && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	async getTerminalContents(commands = -1): Promise<string> {
		// 保存原始剪贴板内容
		const originalContent = await vscode.env.clipboard.readText()

		try {
			// 清除当前选择
			await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

			// 根据 commands 参数选择不同的选择策略
			if (commands < 0) {
				await vscode.commands.executeCommand("workbench.action.terminal.selectAll")
			} else {
				await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
			}

			// 复制选中内容
			await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

			// 获取复制的内容
			const content = await vscode.env.clipboard.readText()

			// 清除选择
			await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

			// 恢复原始剪贴板内容
			await vscode.env.clipboard.writeText(originalContent)

			// 如果内容未变，说明可能没有复制成功
			if (content === originalContent) {
				return ""
			}

			return content
		} catch (error) {
			// 确保恢复剪贴板内容
			await vscode.env.clipboard.writeText(originalContent)
			throw error
		}
	}

	disposeAll() {
		// for (const info of this.terminals) {
		// 	//info.terminal.dispose() // dont want to dispose terminals when task is aborted
		// }
		this.terminalIds.clear()
		this.processes.clear()
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}
}
