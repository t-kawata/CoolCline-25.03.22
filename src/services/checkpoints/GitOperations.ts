import fs from "fs/promises"
import { existsSync } from "fs"
import * as path from "path"
import { SimpleGit, simpleGit, CleanOptions } from "simple-git"
import { fileExists, PathUtils } from "./CheckpointUtils"
import { getLfsPatterns, writeExcludesFile, GIT_DISABLED_SUFFIX } from "./CheckpointExclusions"
import { CheckpointDiff } from "./types"

interface GitCommit {
	hash: string
	message: string
	date: string
}

/**
 * GitOperations 类
 *
 * 处理 CoolCline 的 Checkpoints 系统的 Git 特定操作。
 *
 * 主要职责：
 * - Git 仓库初始化和配置
 * - Git 设置管理（用户、LFS 等）
 * - 文件暂存和 checkpoint 创建
 * - 嵌套 git 仓库管理
 * - 分支管理（branch-per-task 模型）
 */
export class GitOperations {
	private static readonly USER_NAME = "CoolCline"
	private static readonly USER_EMAIL = "checkpoint@coolcline.com"
	private readonly vscodeGlobalStorageCoolClinePath: string
	private readonly userProjectPath: string

	/**
	 * 创建一个新的 GitOperations 实例。
	 *
	 * @param vscodeGlobalStorageCoolClinePath - VSCode 全局存储路径
	 * @param userProjectPath - Git 操作的当前工作目录
	 */
	constructor(vscodeGlobalStorageCoolClinePath: string, userProjectPath: string) {
		this.vscodeGlobalStorageCoolClinePath = PathUtils.normalizePath(vscodeGlobalStorageCoolClinePath)
		this.userProjectPath = PathUtils.normalizePath(userProjectPath)
	}

	private getGit(gitDirPath: string): SimpleGit {
		const workingDir = PathUtils.dirname(gitDirPath)
		return simpleGit(workingDir)
	}

	/**
	 * 初始化或验证用于 checkpoint 跟踪的 shadow Git 仓库。
	 *
	 * @param coolclineShadowGitPath - .git 目录的路径
	 * @returns Promise<string> 初始化的 .git 目录的路径
	 */
	public async initShadowGit(coolclineShadowGitPath: string): Promise<string> {
		console.info("GitOperations: 开始初始化 shadow git, 路径:", coolclineShadowGitPath)

		const normalizedProjectPath = PathUtils.normalizePath(this.userProjectPath)

		if (await fileExists(coolclineShadowGitPath)) {
			const git = this.getGit(coolclineShadowGitPath)

			const worktree = await git.getConfig("core.worktree")
			if (!PathUtils.pathsEqual(worktree.value || "", normalizedProjectPath)) {
				throw new Error("Checkpoints 只能在原始工作区中使用: " + worktree.value)
			}
			console.warn("GitOperations: 使用现有的 shadow git: " + coolclineShadowGitPath)
			return coolclineShadowGitPath
		}

		const checkpointsDir = PathUtils.dirname(coolclineShadowGitPath)
		console.warn("GitOperations: 在 " + checkpointsDir + " 中创建新的 shadow git")

		await fs.mkdir(checkpointsDir, { recursive: true })

		const git = this.getGit(coolclineShadowGitPath)

		await git.init()
		await this.initGitConfig(git)
		await git.addConfig("core.worktree", normalizedProjectPath)

		const lfsPatterns = await getLfsPatterns(normalizedProjectPath)
		await writeExcludesFile(coolclineShadowGitPath, lfsPatterns)

		await this.createInitialCommit(git)

		return coolclineShadowGitPath
	}

	/**
	 * 初始化 Git 配置
	 * 处理全局和本地配置，确保正确的用户信息
	 */
	private async initGitConfig(git: SimpleGit): Promise<void> {
		// 获取全局和本地配置
		const globalUserName = await git.getConfig("user.name", "global")
		const localUserName = await git.getConfig("user.name", "local")
		const userName = localUserName.value || globalUserName.value

		const globalUserEmail = await git.getConfig("user.email", "global")
		const localUserEmail = await git.getConfig("user.email", "local")
		const userEmail = localUserEmail.value || globalUserEmail.value

		// 如果存在全局配置且本地配置匹配默认值，则移除本地配置
		if (globalUserName.value && localUserName.value === GitOperations.USER_NAME) {
			await git.raw(["config", "--unset", "--local", "user.name"])
		}

		if (globalUserEmail.value && localUserEmail.value === GitOperations.USER_EMAIL) {
			await git.raw(["config", "--unset", "--local", "user.email"])
		}

		// 仅在未配置时设置用户信息
		if (!userName) {
			await git.addConfig("user.name", GitOperations.USER_NAME)
		}

		if (!userEmail) {
			await git.addConfig("user.email", GitOperations.USER_EMAIL)
		}

		// 禁用 GPG 签名
		await git.addConfig("commit.gpgSign", "false")
	}

	/**
	 * 创建初始提交
	 * 使用空提交而不是创建 .gitkeep 文件
	 */
	private async createInitialCommit(git: SimpleGit): Promise<void> {
		// 直接创建一个空的初始提交，不需要 .gitkeep 文件
		await git.commit("Initial commit", ["--allow-empty"])
	}

	/**
	 * 暂存当前更改
	 * 包括未跟踪的文件
	 */
	public async stashChanges(gitPath: string): Promise<boolean> {
		const git = this.getGit(gitPath)
		const status = await git.status()
		if (status.files.length > 0) {
			await git.stash(["-u"]) // 包含未跟踪的文件
			return true
		}
		return false
	}

	/**
	 * 应用最近的 stash
	 */
	public async applyStash(gitPath: string): Promise<boolean> {
		const git = this.getGit(gitPath)
		const stashList = await git.stashList()
		if (stashList.all.length > 0) {
			await git.stash(["apply"])
			return true
		}
		return false
	}

	/**
	 * 弹出最近的 stash
	 */
	public async popStash(gitPath: string): Promise<boolean> {
		const git = this.getGit(gitPath)
		const stashList = await git.stashList()
		if (stashList.all.length > 0) {
			await git.stash(["pop", "--index"])
			return true
		}
		return false
	}

	/**
	 * 重命名嵌套的 Git 仓库，临时禁用它们
	 *
	 * @param disable - 是否禁用嵌套的 Git 仓库
	 */
	public async renameNestedGitRepos(disable: boolean) {
		try {
			const gitDirs = await this.findNestedGitDirs()

			for (const gitDir of gitDirs) {
				const disabledPath = PathUtils.joinPath(
					PathUtils.normalizePath(path.dirname(gitDir)),
					`.git${GIT_DISABLED_SUFFIX}`,
				)

				if (disable) {
					if (existsSync(gitDir) && !existsSync(disabledPath)) {
						await fs.rename(gitDir, disabledPath)
					}
				} else {
					if (!existsSync(gitDir) && existsSync(disabledPath)) {
						await fs.rename(disabledPath, gitDir)
					}
				}
			}
		} catch (error) {
			console.error((disable ? "禁用" : "启用") + "嵌套 git 仓库失败:", error)
		}
	}

	/**
	 * 查找所有嵌套的 .git 目录
	 */
	private async findNestedGitDirs(): Promise<string[]> {
		const git = simpleGit(this.userProjectPath)
		const result = await git.raw(["ls-files", "--others", "--exclude-standard", "-z"])
		const files = result.split("\0").filter(Boolean)

		return files
			.filter((file) => file.includes("/.git/") || file === ".git")
			.map((file) => PathUtils.joinPath(this.userProjectPath, file))
	}

	/**
	 * 创建任务分支
	 *
	 * @param taskId - 任务 ID
	 * @param gitPath - .git 目录的路径
	 * @returns Promise<void>
	 */
	public async createTaskBranch(taskId: string, gitPath: string): Promise<void> {
		const git = this.getGit(gitPath)
		const branchName = `task-${taskId}`

		// 更新 excludes 文件
		await writeExcludesFile(gitPath, await getLfsPatterns(this.userProjectPath))

		const branches = await git.branch()
		if (!branches.all.includes(branchName)) {
			await git.checkoutLocalBranch(branchName)
		} else {
			await git.checkout(branchName)
		}
	}

	/**
	 * 删除任务分支
	 *
	 * @param taskId - 任务 ID
	 * @param gitPath - .git 目录的路径
	 * @returns Promise<void>
	 */
	public async deleteTaskBranch(taskId: string, gitPath: string): Promise<void> {
		const git = this.getGit(gitPath)
		const branchName = `task-${taskId}`
		try {
			await git.deleteLocalBranch(branchName, true)
		} catch (error) {
			console.error("删除任务分支失败:", error)
			throw error
		}
	}

	/**
	 * 为 checkpoint 添加文件
	 *
	 * @param gitPath - .git 目录的路径
	 * @returns Promise<{success: boolean}> 添加操作的结果
	 */
	public async addCheckpointFiles(gitPath: string): Promise<{ success: boolean }> {
		const git = this.getGit(gitPath)
		try {
			await git.add(["-A"])
			return { success: true }
		} catch (error) {
			console.error("添加 checkpoint 文件失败:", error)
			return { success: false }
		}
	}

	/**
	 * 获取两个提交之间的差异
	 *
	 * @param gitPath - .git 目录的路径
	 * @param fromHash - 起始提交哈希
	 * @param toHash - 结束提交哈希
	 * @returns Promise<Array<{paths: {relative: string, absolute: string}, content: {before: string, after: string}}>>
	 */
	public async getDiffBetweenCommits(gitPath: string, fromHash: string, toHash: string): Promise<CheckpointDiff[]> {
		const git = this.getGit(gitPath)
		const summary = await git.diffSummary([`${fromHash}..${toHash}`])
		const result: CheckpointDiff[] = []

		for (const file of summary.files.filter((f) => !f.binary)) {
			let before = ""
			let after = ""

			try {
				before = await git.show([`${fromHash}:${file.file}`])
			} catch (error) {
				// 文件在 'from' 提交中不存在
			}

			try {
				after = await git.show([`${toHash}:${file.file}`])
			} catch (error) {
				// 文件在 'to' 提交中不存在
			}

			result.push({
				relativePath: file.file,
				absolutePath: `${this.userProjectPath}/${file.file}`,
				before,
				after,
			})
		}

		return result
	}

	/**
	 * 获取跨任务的差异
	 *
	 * @param gitPath - .git 目录的路径
	 * @param fromTaskId - 起始任务 ID
	 * @param fromHash - 起始提交哈希
	 * @param toTaskId - 结束任务 ID
	 * @param toHash - 结束提交哈希
	 * @returns Promise<Array<{paths: {relative: string, absolute: string}, content: {before: string, after: string}}>>
	 */
	public async getDiffAcrossTasks(
		gitPath: string,
		fromTaskId: string,
		fromHash: string,
		toTaskId: string,
		toHash: string,
	): Promise<CheckpointDiff[]> {
		const git = this.getGit(gitPath)
		// 保存当前分支
		const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])

		try {
			// 切换到起始任务分支
			await git.checkout(`task-${fromTaskId}`)
			const fromCommit = await git.revparse([fromHash])

			// 切换到结束任务分支
			await git.checkout(`task-${toTaskId}`)
			const toCommit = await git.revparse([toHash])

			// 获取差异
			const result = await this.getDiffBetweenCommits(gitPath, fromCommit, toCommit)

			// 恢复原始分支
			await git.checkout(currentBranch)

			return result
		} catch (error) {
			// 确保恢复原始分支
			await git.checkout(currentBranch)
			throw error
		}
	}

	/**
	 * 恢复到指定的 checkpoint
	 *
	 * @param gitPath - .git 目录的路径
	 * @param hash - 要恢复到的 checkpoint 哈希
	 * @returns Promise<void>
	 */
	public async restoreCheckpoint(gitPath: string, hash: string): Promise<void> {
		try {
			const git = this.getGit(gitPath)
			// 清理工作区
			await git.clean([CleanOptions.FORCE, CleanOptions.RECURSIVE])
			// 恢复文件
			await git.raw(["restore", "--source", hash, "--worktree", "--", "."])
		} catch (error) {
			console.error("GitOperations: 恢复 checkpoint 失败:", error)
			throw error
		}
	}

	public async commit(gitPath: string, message: string): Promise<string> {
		try {
			const git = this.getGit(gitPath)

			await git.add(".")

			const result = await git.commit(message)
			return result.commit
		} catch (error) {
			console.error("GitOperations: 提交更改失败:", error)
			throw error
		}
	}

	async getCommits(gitPath: string): Promise<GitCommit[]> {
		const git = this.getGit(gitPath)
		const log = await git.log()
		return log.all.map((commit) => ({
			hash: commit.hash,
			message: commit.message,
			date: commit.date,
		}))
	}

	/**
	 * 获取与工作区的差异
	 * @param gitPath - .git 目录的路径
	 * @param hash - 要与工作区比较的 commit hash
	 */
	async getDiffWithWorkingDir(gitPath: string, hash: string): Promise<CheckpointDiff[]> {
		const git = this.getGit(gitPath)
		const summary = await git.diffSummary([hash])
		const result: CheckpointDiff[] = []

		for (const file of summary.files) {
			const relativePath = file.file
			const absolutePath = PathUtils.joinPath(this.userProjectPath, relativePath)

			let before = ""
			let after = ""

			try {
				// 获取指定 commit 中的文件内容
				before = await git.show([`${hash}:${file.file}`])
			} catch (error) {
				// 文件在指定 commit 中不存在
			}

			try {
				// 获取工作区中的文件内容
				after = await fs.readFile(absolutePath, "utf-8")
			} catch (error) {
				// 文件在工作区中不存在
			}

			const diff: CheckpointDiff = {
				relativePath,
				absolutePath,
				before,
				after,
			}
			result.push(diff)
		}

		return result
	}

	/**
	 * 获取差异
	 * @param gitPath - .git 目录的路径
	 * @param hash1 - 第一个 commit hash
	 * @param hash2 - 第二个 commit hash，如果不提供则与工作区比较
	 */
	async getDiff(gitPath: string, hash1: string, hash2?: string): Promise<CheckpointDiff[]> {
		if (!hash2) {
			return this.getDiffWithWorkingDir(gitPath, hash1)
		}

		const git = this.getGit(gitPath)
		const summary = await git.diffSummary([hash1, hash2])
		const result: CheckpointDiff[] = []

		for (const file of summary.files) {
			const relativePath = file.file
			const absolutePath = PathUtils.joinPath(this.userProjectPath, relativePath)

			let before = ""
			let after = ""

			try {
				before = await git.show([`${hash1}:${file.file}`])
			} catch (error) {
				// 文件在 hash1 中不存在
			}

			try {
				after = await git.show([`${hash2}:${file.file}`])
			} catch (error) {
				// 文件在 hash2 中不存在
			}

			const diff: CheckpointDiff = {
				relativePath,
				absolutePath,
				before,
				after,
			}
			result.push(diff)
		}

		return result
	}

	/**
	 * 清理旧的 checkpoints
	 * @param gitPath - .git 目录的路径
	 * @param hashes - 要清理的 checkpoint hash 列表
	 */
	public async cleanupCheckpoints(gitPath: string, hashes: string[]): Promise<void> {
		const git = this.getGit(gitPath)
		try {
			for (const hash of hashes) {
				await git.raw(["update-ref", "-d", `refs/checkpoints/${hash}`])
			}
			await git.raw(["gc", "--prune=now"])
		} catch (error) {
			console.error("Failed to cleanup checkpoints:", error)
			throw error
		}
	}
}
