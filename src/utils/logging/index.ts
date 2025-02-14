/**
 * @fileoverview 日志记录器入口文件,导出默认实例和测试用的空日志记录器
 */

import { CompactLogger } from "./CompactLogger"
import { CompactTransport } from "./CompactTransport"
import { ILogger } from "./types"

// 创建默认的日志传输实例
const defaultTransport = new CompactTransport({
	level: "info",
	filePath: "./logs/app.log",
})

// 创建并导出默认的日志记录器实例
export const logger = new CompactLogger(defaultTransport)

// 导出一个空的日志记录器,用于生产环境
export const noopLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	child: () => noopLogger,
	close: () => {},
}

// 导出所有类型和实现
export * from "./types"
export * from "./CompactLogger"
export * from "./CompactTransport"
