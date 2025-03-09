import { jest } from "@jest/globals"
import { FileFilter } from "../FileFilter"
import { createTestEnvironment, TestEnvironment } from "./test-utils"
import path from "path"
import fs from "fs/promises"

describe("FileFilter", () => {
	let env: TestEnvironment
	let filter: FileFilter

	beforeEach(async () => {
		env = await createTestEnvironment()
		filter = new FileFilter(env.workspaceRoot)
	})

	afterEach(async () => {
		await env.cleanup()
	})

	describe("shouldExclude", () => {
		it("应该排除默认排除的文件", async () => {
			const files = [
				path.join(env.workspaceRoot, "node_modules/test.js"),
				path.join(env.workspaceRoot, "dist/app.js"),
				path.join(env.workspaceRoot, "src/app.js"),
			]

			const results = await Promise.all(files.map((f) => filter.shouldExclude(f)))
			expect(results).toEqual([true, true, false])
		})

		it("应该排除大文件", async () => {
			const testFile = path.join(env.workspaceRoot, "large.txt")
			const content = Buffer.alloc(101 * 1024 * 1024) // 101MB
			await fs.writeFile(testFile, content)

			const result = await filter.shouldExclude(testFile)
			expect(result).toBe(true)
		})
	})

	describe("getIncludedFiles", () => {
		it("应该返回不被排除的文件", async () => {
			const env = await createTestEnvironment()
			const filter = new FileFilter(env.workspaceRoot)
			const files = await filter.getIncludedFiles()
			const relativePaths = files.map((f) => path.relative(env.workspaceRoot, f))
			expect(relativePaths.sort()).toEqual([".gitignore", "src/app.js", "src/test.js"].sort())
		})
	})

	describe("isLargeFile", () => {
		it("应该正确识别大文件", async () => {
			const testFile = path.join(env.workspaceRoot, "large.txt")
			const content = Buffer.alloc(101 * 1024 * 1024) // 101MB
			await fs.writeFile(testFile, content)

			const result = await filter.isLargeFile(testFile)
			expect(result).toBe(true)
		})

		it("应该正确识别小文件", async () => {
			const testFile = path.join(env.workspaceRoot, "small.txt")
			await fs.writeFile(testFile, "small file")

			const result = await filter.isLargeFile(testFile)
			expect(result).toBe(false)
		})
	})
})
