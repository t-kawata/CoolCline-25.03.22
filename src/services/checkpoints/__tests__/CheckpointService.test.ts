// npx jest src/services/checkpoints/__tests__/CheckpointService.test.ts

import fs from "fs/promises"
import path from "path"
import os from "os"
import "../../../utils/path"

import { simpleGit, SimpleGit } from "simple-git"
import * as vscode from "vscode"

import { CheckpointService } from "../CheckpointService"
import { StorageProvider } from "../types"

jest.setTimeout(30000)

// Mock vscode namespace
jest.mock("vscode", () => ({
	window: {
		createOutputChannel: jest.fn().mockReturnValue({
			appendLine: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
			show: jest.fn(),
		}),
	},
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/test/workspace",
					scheme: "file",
					path: "/test/workspace",
					toString: () => "/test/workspace",
				},
				name: "test",
				index: 0,
			},
		],
		fs: {
			stat: jest.fn().mockResolvedValue({ type: 1 }), // FileType.File = 1
		},
		createFileSystemWatcher: jest.fn(() => ({
			onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
			onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
			dispose: jest.fn(),
		})),
	},
	Uri: {
		file: (path: string) => ({
			fsPath: path,
			scheme: "file",
			path: path,
			toString: () => path,
		}),
	},
}))

describe("CheckpointService", () => {
	let baseDir: string
	let git: SimpleGit
	let testFile: string
	let service: CheckpointService
	let originalPlatform: string
	const taskId = "test-task"

	const mockStorageProvider: StorageProvider = {
		context: {
			globalStorageUri: {
				fsPath: "",
			},
		},
	}

	const initRepo = async ({
		baseDir,
		initialContent = "Hello, world!",
	}: {
		baseDir: string
		initialContent?: string
	}): Promise<{ git: SimpleGit; testFile: string }> => {
		await fs.mkdir(baseDir, { recursive: true })
		git = simpleGit({
			baseDir,
			config: [],
		})

		await git.init()
		await git.addConfig("user.name", "CoolCline")
		await git.addConfig("user.email", "support@coolcline.com")
		testFile = path.join(baseDir, "test.txt")
		await fs.writeFile(testFile, initialContent)
		await git.add("test.txt")
		await git.commit("Initial commit")

		return { git, testFile }
	}

	beforeAll(() => {
		originalPlatform = process.platform
		Object.defineProperty(process, "platform", {
			value: "darwin",
		})
	})

	afterAll(() => {
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
		})
	})

	beforeEach(async () => {
		baseDir = path.join(os.tmpdir(), `checkpoint-service-test-${Date.now()}`)
		const repo = await initRepo({ baseDir })
		git = repo.git
		testFile = repo.testFile
		mockStorageProvider.context.globalStorageUri.fsPath = baseDir
		service = await CheckpointService.create(taskId, mockStorageProvider)
		await service.initialize()
	})

	afterEach(async () => {
		if (service) {
			service.dispose()
		}
		await fs.rm(baseDir, { recursive: true, force: true })
		jest.restoreAllMocks()
	})

	describe("basic functionality", () => {
		it.skip("saves and restores checkpoints", async () => {
			// Save first checkpoint
			await fs.writeFile(testFile, "First change")
			const commit1 = await service.saveCheckpoint("First checkpoint")
			expect(commit1?.hash).toBeTruthy()

			// Save second checkpoint
			await fs.writeFile(testFile, "Second change")
			const commit2 = await service.saveCheckpoint("Second checkpoint")
			expect(commit2?.hash).toBeTruthy()

			// Restore to first checkpoint
			await service.restoreCheckpoint(commit1!.hash)
			expect(await fs.readFile(testFile, "utf-8")).toBe("First change")

			// Restore to second checkpoint
			await service.restoreCheckpoint(commit2!.hash)
			expect(await fs.readFile(testFile, "utf-8")).toBe("Second change")

			// Restore to initial state
			await service.initialize()
			expect(await fs.readFile(testFile, "utf-8")).toBe("Hello, world!")
		})

		it.skip("gets correct diffs between checkpoints", async () => {
			await fs.writeFile(testFile, "Ahoy, world!")
			const commit1 = await service.saveCheckpoint("First checkpoint")
			expect(commit1?.hash).toBeTruthy()

			await fs.writeFile(testFile, "Goodbye, world!")
			const commit2 = await service.saveCheckpoint("Second checkpoint")
			expect(commit2?.hash).toBeTruthy()

			const diff = await service.getDiff(commit1!.hash, commit2!.hash)
			expect(diff).toHaveLength(1)
			expect(diff[0].relativePath).toBe("test.txt")
			expect(diff[0].absolutePath).toBe(testFile)
			expect(diff[0].before).toBe("Ahoy, world!")
			expect(diff[0].after).toBe("Goodbye, world!")
		})

		it.skip("handles failed operations gracefully", async () => {
			// Save initial checkpoint
			await fs.writeFile(testFile, "Initial change")
			const commit1 = await service.saveCheckpoint("Initial checkpoint")
			expect(commit1?.hash).toBeTruthy()

			// Mock git commit to simulate failure
			const gitCommitSpy = jest.spyOn(git, "commit")
			gitCommitSpy.mockRejectedValueOnce(new Error("Git error"))

			// Attempt to save checkpoint
			await fs.writeFile(testFile, "Failed change")
			await expect(service.saveCheckpoint("Failed checkpoint")).rejects.toThrow()
		})
	})
})
