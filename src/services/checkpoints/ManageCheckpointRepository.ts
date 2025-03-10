import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

export class ManageCheckpointRepository {
	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * 删除 checkpoint 仓库并确保当前项目的目录存在
	 * @param deleteAll 是否删除所有项目的仓库
	 * @param currentWorkspaceHash 当前工作区的哈希值
	 */
	public async cleanCheckpointRepositories(deleteAll: boolean, currentWorkspaceHash: string) {
		const shadowGitBasePath = path.join(this.context.globalStorageUri.fsPath, "shadow-git")

		try {
			if (deleteAll) {
				// 删除整个 shadow-git 目录
				await fs.rm(shadowGitBasePath, { recursive: true, force: true })
				// 重新创建 shadow-git 基础目录
				await fs.mkdir(shadowGitBasePath, { recursive: true })
			} else {
				// 删除当前项目的 checkpoint 目录
				const projectCheckpointDir = path.join(shadowGitBasePath, currentWorkspaceHash)
				await fs.rm(projectCheckpointDir, { recursive: true, force: true })
			}

			// 确保当前项目的 checkpoint 目录存在
			await fs.mkdir(path.join(shadowGitBasePath, currentWorkspaceHash), { recursive: true })
		} catch (error) {
			console.error(`Error handling checkpoint repositories: ${error}`)
			throw error
		}
	}

	/**
	 * 确保当前项目的 checkpoint 目录存在
	 * @param currentWorkspaceHash 当前工作区的哈希值
	 */
	public async ensureProjectCheckpointDirectory(currentWorkspaceHash: string) {
		const projectCheckpointDir = path.join(this.context.globalStorageUri.fsPath, "shadow-git", currentWorkspaceHash)
		await fs.mkdir(projectCheckpointDir, { recursive: true })
		return projectCheckpointDir
	}

	/**
	 * 获取项目的 checkpoint 目录路径
	 * @param currentWorkspaceHash 当前工作区的哈希值
	 */
	public getProjectCheckpointPath(currentWorkspaceHash: string): string {
		return path.join(this.context.globalStorageUri.fsPath, "shadow-git", currentWorkspaceHash)
	}
}
