/**
 * @fileoverview CompactTransport 的测试用例
 */

import { CompactTransport } from "../CompactTransport"
import { CompactLogEntry, LogLevel } from "../types"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("CompactTransport", () => {
	let transport: CompactTransport
	let logFilePath: string

	beforeEach(() => {
		logFilePath = path.join(os.tmpdir(), `test-log-${Date.now()}.log`)
		transport = new CompactTransport({
			level: "debug",
			filePath: logFilePath,
		})
	})

	afterEach(() => {
		transport.close()
		if (fs.existsSync(logFilePath)) {
			fs.unlinkSync(logFilePath)
		}
	})

	it("should create log file and write entries", () => {
		const entry: CompactLogEntry = {
			t: Date.now(),
			l: "info",
			m: "test message",
		}

		transport.write(entry)
		transport.close()

		expect(fs.existsSync(logFilePath)).toBe(true)
		const fileContent = fs.readFileSync(logFilePath, "utf-8")
		expect(fileContent).toContain(entry.m)
	})

	it("should respect log level filtering", () => {
		const transport = new CompactTransport({
			level: "warn",
			filePath: logFilePath,
		})

		const levels: LogLevel[] = ["debug", "info", "warn", "error", "fatal"]
		levels.forEach((level) => {
			transport.write({
				t: Date.now(),
				l: level,
				m: `${level} message`,
			})
		})

		transport.close()
		const fileContent = fs.readFileSync(logFilePath, "utf-8")

		expect(fileContent).not.toContain("debug message")
		expect(fileContent).not.toContain("info message")
		expect(fileContent).toContain("warn message")
		expect(fileContent).toContain("error message")
		expect(fileContent).toContain("fatal message")
	})

	it("should handle concurrent writes", async () => {
		const entries = Array.from({ length: 100 }, (_, i) => ({
			t: Date.now(),
			l: "info" as const,
			m: `message ${i}`,
		}))

		await Promise.all(
			entries.map(
				(entry) =>
					new Promise<void>((resolve) => {
						transport.write(entry)
						resolve()
					}),
			),
		)

		transport.close()
		const fileContent = fs.readFileSync(logFilePath, "utf-8")
		entries.forEach((entry) => {
			expect(fileContent).toContain(entry.m)
		})
	})

	it("should handle metadata in log entries", () => {
		const entry: CompactLogEntry = {
			t: Date.now(),
			l: "info",
			m: "test message",
			c: "test-context",
			d: {
				id: "test-id",
				user: "test-user",
			},
		}

		transport.write(entry)
		transport.close()

		const fileContent = fs.readFileSync(logFilePath, "utf-8")
		expect(fileContent).toContain(entry.c)
		expect(fileContent).toContain(entry.d?.id)
		expect(fileContent).toContain(entry.d?.user)
	})

	it("should handle errors gracefully", () => {
		// 使用不存在的目录
		const invalidTransport = new CompactTransport({
			level: "info",
			filePath: "/nonexistent/directory/test.log",
		})

		expect(() => {
			invalidTransport.write({
				t: Date.now(),
				l: "info",
				m: "test message",
			})
		}).not.toThrow()

		invalidTransport.close()
	})
})
