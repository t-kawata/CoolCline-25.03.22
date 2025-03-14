import * as vscode from "vscode"
import * as fs from "fs/promises"
import { PathUtils } from "./CheckpointUtils"
import { ensureShadowGitDir } from "./CheckpointUtils"

export class ManageCheckpointRepository {
	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * 批量删除历史消息，设置页面 reset 都会执行这个方法
	 * 删除 checkpoint 仓库并确保当前项目的目录存在
	 * @param deleteAll 是否删除所有项目的仓库
	 * @param currentWorkspaceHash 当前工作区的哈希值
	 */
	public async cleanCheckpointRepositories(deleteAll: boolean, currentWorkspaceHash: string) {
		const shadowGitDir = await ensureShadowGitDir(currentWorkspaceHash)
		const shadowGitBasePath = PathUtils.dirname(shadowGitDir)

		try {
			if (deleteAll) {
				// 删除整个 shadow-git 目录
				await fs.rm(shadowGitBasePath, { recursive: true, force: true })
				// 重新创建 shadow-git 基础目录并确保当前项目目录存在
				await ensureShadowGitDir(currentWorkspaceHash)
			} else {
				// 删除当前项目的 checkpoint 目录
				const projectCheckpointDir = PathUtils.joinPath(shadowGitBasePath, currentWorkspaceHash)
				await fs.rm(projectCheckpointDir, { recursive: true, force: true })
				// 重新创建当前项目的目录
				await ensureShadowGitDir(currentWorkspaceHash)
			}
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
		return await ensureShadowGitDir(currentWorkspaceHash)
	}

	/**
	 * 获取项目的 checkpoint 目录路径
	 * @param currentWorkspaceHash 当前工作区的哈希值
	 */
	public async getProjectCheckpointPath(currentWorkspaceHash: string): Promise<string> {
		return await ensureShadowGitDir(currentWorkspaceHash)
	}
}
