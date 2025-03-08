import fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { fileExists, PathUtils } from "./CheckpointUtils"

/**
 * CheckpointMigration 类
 *
 * 处理 checkpoint 系统的迁移和清理。
 * 主要用于：
 * - 清理旧版本的 checkpoints
 * - 迁移到新的存储结构
 * - 处理孤立的资源
 */
export class CheckpointMigration {
	/**
	 * 清理旧版本的 checkpoints
	 * 这是一个一次性操作，在扩展更新到新的 checkpoint 系统时运行
	 *
	 * @param vscodeGlobalStorageCoolClinePath - 扩展的全局存储路径
	 * @param outputChannel - VSCode 输出通道，用于日志记录
	 */
	public static async cleanupLegacyCheckpoints(
		vscodeGlobalStorageCoolClinePath: string,
		outputChannel: vscode.OutputChannel,
	): Promise<void> {
		try {
			outputChannel.appendLine("检查旧版本 checkpoints...")

			const tasksDir = PathUtils.toPosixPath(path.join(vscodeGlobalStorageCoolClinePath, "tasks"))

			// 检查任务目录是否存在
			if (!(await fileExists(tasksDir))) {
				return // 没有任务目录，无需清理
			}

			// 获取所有任务文件夹
			const taskFolders = await fs.readdir(tasksDir)
			if (taskFolders.length === 0) {
				return // 没有任务文件夹，无需清理
			}

			// 获取每个文件夹的统计信息以按创建时间排序
			const folderStats = await Promise.all(
				taskFolders.map(async (folder) => {
					const folderPath = PathUtils.toPosixPath(path.join(tasksDir, folder))
					const stats = await fs.stat(folderPath)
					return { folder, path: folderPath, stats }
				}),
			)

			// 按创建时间排序，最新的在前
			folderStats.sort((a, b) => b.stats.birthtimeMs - a.stats.birthtimeMs)

			// 检查最近的任务文件夹是否有 checkpoints 目录
			if (folderStats.length > 0) {
				const mostRecentFolder = folderStats[0]
				const checkpointsDir = PathUtils.toPosixPath(path.join(mostRecentFolder.path, "checkpoints"))

				if (await fileExists(checkpointsDir)) {
					outputChannel.appendLine("发现旧版本 checkpoints 目录，正在清理...")

					// 找到旧版本 checkpoints，删除所有任务文件夹中的 checkpoints 目录
					for (const { path: folderPath } of folderStats) {
						const oldCheckpointsDir = PathUtils.toPosixPath(path.join(folderPath, "checkpoints"))
						if (await fileExists(oldCheckpointsDir)) {
							await fs.rm(oldCheckpointsDir, { recursive: true, force: true })
							outputChannel.appendLine(`已删除: ${oldCheckpointsDir}`)
						}
					}

					outputChannel.appendLine("旧版本 checkpoints 清理完成")
				}
			}
		} catch (error) {
			outputChannel.appendLine(`清理旧版本 checkpoints 失败: ${error}`)
			throw error
		}
	}

	/**
	 * 迁移到新的存储结构
	 * 将独立的 checkpoint 仓库合并到单一的 shadow git 仓库中
	 *
	 * @param vscodeGlobalStorageCoolClinePath - 扩展的全局存储路径
	 * @param outputChannel - VSCode 输出通道，用于日志记录
	 */
	public static async migrateToNewStructure(
		vscodeGlobalStorageCoolClinePath: string,
		outputChannel: vscode.OutputChannel,
	): Promise<void> {
		try {
			outputChannel.appendLine("开始迁移到新的存储结构...")

			const oldCheckpointsDir = PathUtils.joinPath(vscodeGlobalStorageCoolClinePath, "checkpoints")
			const newCheckpointsDir = PathUtils.joinPath(vscodeGlobalStorageCoolClinePath, "shadow-git")

			// 检查旧目录是否存在
			if (!(await fileExists(oldCheckpointsDir))) {
				return // 没有旧数据，无需迁移
			}

			// 创建新目录
			await fs.mkdir(newCheckpointsDir, { recursive: true })

			// 获取所有工作区目录
			const workspaceDirs = await fs.readdir(oldCheckpointsDir)

			for (const workspaceDir of workspaceDirs) {
				const oldWorkspacePath = PathUtils.toPosixPath(path.join(oldCheckpointsDir, workspaceDir))
				const newWorkspacePath = PathUtils.toPosixPath(path.join(newCheckpointsDir, workspaceDir))

				// 如果是目录且包含 .git
				if ((await fs.stat(oldWorkspacePath)).isDirectory()) {
					const gitDir = PathUtils.toPosixPath(path.join(oldWorkspacePath, ".git"))
					if (await fileExists(gitDir)) {
						try {
							// 如果目标目录已存在，先删除它
							if (await fileExists(newWorkspacePath)) {
								await fs.rm(newWorkspacePath, { recursive: true, force: true })
							}
							// 移动到新位置
							await fs.rename(oldWorkspacePath, newWorkspacePath)
							outputChannel.appendLine(`已迁移: ${oldWorkspacePath} -> ${newWorkspacePath}`)
						} catch (error) {
							outputChannel.appendLine(`迁移 ${oldWorkspacePath} 失败: ${error}`)
							// 继续处理其他目录
							continue
						}
					}
				}
			}

			// 删除旧目录
			try {
				await fs.rm(oldCheckpointsDir, { recursive: true, force: true })
				outputChannel.appendLine("迁移完成")
			} catch (error) {
				outputChannel.appendLine(`删除旧目录失败: ${error}`)
				// 不抛出错误，因为主要迁移工作已完成
			}
		} catch (error) {
			outputChannel.appendLine(`迁移失败: ${error}`)
			throw error
		}
	}

	/**
	 * 清理孤立的资源
	 * 删除没有对应任务的 checkpoint 分支
	 *
	 * @param vscodeGlobalStorageCoolClinePath - 扩展的全局存储路径
	 * @param activeTasks - 活动任务的 ID 列表
	 * @param outputChannel - VSCode 输出通道，用于日志记录
	 */
	public static async cleanupOrphanedResources(
		vscodeGlobalStorageCoolClinePath: string,
		activeTasks: string[],
		outputChannel: vscode.OutputChannel,
	): Promise<void> {
		try {
			outputChannel.appendLine("开始清理孤立资源...")

			const checkpointsDir = PathUtils.toPosixPath(path.join(vscodeGlobalStorageCoolClinePath, "shadow-git"))
			if (!(await fileExists(checkpointsDir))) {
				return
			}

			// 获取所有工作区目录
			const workspaceDirs = await fs.readdir(checkpointsDir)

			for (const workspaceDir of workspaceDirs) {
				const workspacePath = PathUtils.toPosixPath(path.join(checkpointsDir, workspaceDir))
				const gitDir = PathUtils.toPosixPath(path.join(workspacePath, ".git"))

				if (await fileExists(gitDir)) {
					// 获取所有分支
					const branchesFile = PathUtils.toPosixPath(path.join(gitDir, "refs", "heads"))
					if (await fileExists(branchesFile)) {
						const branches = await fs.readdir(branchesFile)

						// 删除不在活动任务列表中的分支
						for (const branch of branches) {
							const taskId = branch.replace("task-", "")
							if (!activeTasks.includes(taskId)) {
								const branchPath = PathUtils.toPosixPath(path.join(branchesFile, branch))
								await fs.unlink(branchPath)
								outputChannel.appendLine(`已删除孤立分支: ${branch}`)
							}
						}
					}
				}
			}

			outputChannel.appendLine("孤立资源清理完成")
		} catch (error) {
			outputChannel.appendLine(`清理孤立资源失败: ${error}`)
			throw error
		}
	}
}
