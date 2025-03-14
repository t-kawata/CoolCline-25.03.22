import { SimpleGit } from "simple-git"

export interface StorageProvider {
	context: {
		globalStorageUri: { fsPath: string }
	}
}

// 基础类型
export type CheckpointMode = "create" | "restore" | "undo_restore"
export type CheckpointRestoreMode = "restore_this_change" | "restore_this_and_after_change" | "undo_restore"

// 检查点基础信息
export interface CheckpointInfo {
	hash: string
	timestamp: Date
	taskId: string
	type: CheckpointMode
	targetHash?: string
	restoreMode?: CheckpointRestoreMode
}

// 操作返回类型
export interface CreateCheckpointResult {
	taskId: string
	hash: string
	timestamp: Date
}

export interface RestoreResult {
	taskId: string
	targetHash: string
	restoreMode: CheckpointRestoreMode
	hash: string
	timestamp: Date
}

export interface UndoRestoreResult {
	taskId: string
	targetHash: string
	restoreMode: CheckpointRestoreMode
	hash: string
	timestamp: Date
}

export interface GetCheckpointsResult {
	checkpoints: CheckpointInfo[]
}

// 操作参数类型
export interface RestoreOptions {
	restoreMode: CheckpointRestoreMode
	hash: string
}

// 事务状态
export interface TransactionState {
	taskId: string
	startHash: string
	currentHash: string
	operationType: CheckpointMode
	restoreMode?: CheckpointRestoreMode
	targetHash?: string
}

export interface CheckpointDiff {
	relativePath: string
	absolutePath: string
	before: string
	after: string
}

export interface CheckpointServiceOptions {
	taskId: string
	git?: SimpleGit
	vscodeGlobalStorageCoolClinePath: string
	userProjectPath: string
	log?: (message: string) => void
	provider?: StorageProvider
}
