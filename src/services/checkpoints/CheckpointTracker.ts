import simpleGit, { SimpleGit } from "simple-git"
import { GitOperations } from "./GitOperations"
import { getShadowGitPath, hashWorkingDir, getWorkingDirectory } from "./CheckpointUtils"
import { StorageProvider } from "./types"
import { PathUtils } from "./CheckpointUtils"

/**
 * CheckpointTracker 类
 *
 * 负责 CoolCline 的 Shadow Git 仓库的初始化和基础管理。
 * 主要职责：
 * - Shadow Git 仓库初始化
 * - 嵌套 Git 仓库管理
 */
export class CheckpointTracker {
	private readonly vscodeGlobalStorageCoolClinePath: string
	private readonly userProjectPath: string
	private readonly cwdHash: string
	private readonly taskId: string
	private readonly cwd: string
	private readonly gitOperations: GitOperations
	private shadowGit?: SimpleGit
	private gitPath?: string
	private isInitialized = false

	constructor(vscodeGlobalStorageCoolClinePath: string, taskId: string, userProjectPath: string) {
		this.vscodeGlobalStorageCoolClinePath = PathUtils.normalizePath(vscodeGlobalStorageCoolClinePath)
		this.userProjectPath = PathUtils.normalizePath(userProjectPath)
		this.cwdHash = hashWorkingDir(this.userProjectPath)
		this.taskId = taskId
		this.cwd = this.userProjectPath
		this.gitOperations = new GitOperations(this.vscodeGlobalStorageCoolClinePath, this.cwd)
	}

	/**
	 * 初始化 shadow git 仓库
	 */
	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		try {
			// 获取 shadow git 路径
			const coolclineShadowGitPath = await getShadowGitPath(
				this.vscodeGlobalStorageCoolClinePath,
				this.taskId,
				this.cwdHash,
			)

			// 初始化 shadow git 仓库
			this.gitPath = await this.gitOperations.initShadowGit(coolclineShadowGitPath)

			// 创建 SimpleGit 实例
			this.shadowGit = simpleGit(PathUtils.dirname(coolclineShadowGitPath))

			this.isInitialized = true
		} catch (error) {
			console.error("初始化 shadow git 仓库失败:", error)
			throw error
		}
	}

	/**
	 * 获取初始化后的 git 路径
	 */
	public getGitPath(): string | undefined {
		return this.gitPath
	}

	/**
	 * 禁用/启用嵌套的 Git 仓库
	 */
	public async toggleNestedGitRepos(disable: boolean): Promise<void> {
		await this.gitOperations.renameNestedGitRepos(disable)
	}

	/**
	 * 创建一个新的 CheckpointTracker 实例
	 */
	public static async create(provider: StorageProvider, taskId: string): Promise<CheckpointTracker> {
		const vscodeGlobalStorageCoolClinePath = provider.context.globalStorageUri.fsPath
		if (!vscodeGlobalStorageCoolClinePath) {
			throw new Error("无法获取 VSCode 全局存储路径")
		}

		const userProjectPath = await getWorkingDirectory()
		const tracker = new CheckpointTracker(vscodeGlobalStorageCoolClinePath, taskId, userProjectPath)
		await tracker.initialize()
		return tracker
	}
}
