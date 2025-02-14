/**
 * @fileoverview 实现紧凑日志传输系统,支持文件输出功能
 */

import { writeFileSync, mkdirSync } from "fs"
import { dirname } from "path"
import { CompactTransportConfig, ICompactTransport, CompactLogEntry, LogLevel, LOG_LEVELS } from "./types"

/**
 * 根据配置的最低级别判断日志条目是否应该被处理
 * @param configLevel - 配置中的最低日志级别
 * @param entryLevel - 当前日志条目的级别
 * @returns 是否应该处理该条目
 */
function isLevelEnabled(configLevel: LogLevel, entryLevel: string): boolean {
	const configIdx = LOG_LEVELS.indexOf(configLevel)
	const entryIdx = LOG_LEVELS.indexOf(entryLevel as LogLevel)
	return entryIdx >= configIdx
}

/**
 * 实现支持文件输出的紧凑日志传输
 * @implements {ICompactTransport}
 */
export class CompactTransport implements ICompactTransport {
	private sessionStart: number
	private lastTimestamp: number
	private filePath: string
	private initialized: boolean = false
	private initError: Error | null = null

	/**
	 * 创建新的 CompactTransport 实例
	 * @param config - 传输配置
	 */
	constructor(readonly config: CompactTransportConfig) {
		this.sessionStart = Date.now()
		this.lastTimestamp = this.sessionStart
		this.filePath = config.filePath
	}

	/**
	 * 确保日志文件已初始化,包括创建必要的目录结构和会话开始标记
	 * @private
	 */
	private ensureInitialized(): void {
		if (this.initialized || this.initError) return

		try {
			mkdirSync(dirname(this.filePath), { recursive: true })
			writeFileSync(this.filePath, "", { flag: "w" })

			const sessionStart = {
				t: 0,
				l: "info",
				m: "日志会话已开始",
				d: { timestamp: new Date(this.sessionStart).toISOString() },
			}
			writeFileSync(this.filePath, JSON.stringify(sessionStart) + "\n", { flag: "w" })

			this.initialized = true
		} catch (err) {
			this.initError = new Error(`初始化日志文件失败: ${(err as Error).message}`)
			// 不抛出错误，而是记录初始化失败
			console.error(this.initError.message)
		}
	}

	/**
	 * 将日志条目写入配置的输出(控制台和/或文件)
	 * @param entry - 要写入的日志条目
	 */
	write(entry: CompactLogEntry): void {
		// 首先检查日志级别
		if (!isLevelEnabled(this.config.level, entry.l)) {
			return
		}

		const deltaT = entry.t - this.lastTimestamp
		this.lastTimestamp = entry.t

		const compact = {
			...entry,
			t: deltaT,
		}

		const output = JSON.stringify(compact) + "\n"

		// 写入控制台
		process.stdout.write(output)

		// 尝试写入文件
		this.ensureInitialized()
		if (this.initialized && !this.initError) {
			try {
				writeFileSync(this.filePath, output, { flag: "a" })
			} catch (err) {
				console.error(`写入日志文件失败: ${(err as Error).message}`)
			}
		}
	}

	/**
	 * 关闭传输并写入会话结束标记
	 */
	close(): void {
		if (this.initialized && !this.initError) {
			try {
				const sessionEnd = {
					t: Date.now() - this.lastTimestamp,
					l: "info",
					m: "日志会话已结束",
					d: { timestamp: new Date().toISOString() },
				}
				writeFileSync(this.filePath, JSON.stringify(sessionEnd) + "\n", { flag: "a" })
			} catch (err) {
				console.error(`写入会话结束标记失败: ${(err as Error).message}`)
			}
		}
	}
}
