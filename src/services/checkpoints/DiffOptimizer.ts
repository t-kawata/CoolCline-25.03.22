import { SimpleGit, DiffResult } from "simple-git"
import { CacheManager } from "./CacheManager"
import { PathUtils } from "./CheckpointUtils"
import pLimit from "p-limit"

/**
 * Diff 计算优化器
 * 实现增量 diff 计算和并发控制
 */
export class DiffOptimizer {
	private readonly cache: CacheManager
	private readonly concurrencyLimit: number
	private readonly limiter: ReturnType<typeof pLimit>
	private readonly MAX_FILE_SIZE = 1024 * 1024 // 1MB
	private readonly MAX_TOTAL_SIZE = 10 * 1024 * 1024 // 10MB

	constructor(
		private readonly git: SimpleGit,
		concurrencyLimit = 5,
	) {
		this.cache = CacheManager.getInstance()
		this.concurrencyLimit = concurrencyLimit
		this.limiter = pLimit(concurrencyLimit)
	}

	/**
	 * 计算两个提交之间的差异
	 * 使用增量计算和缓存优化性能
	 */
	async computeDiff(
		fromHash: string,
		toHash: string,
	): Promise<
		Array<{
			relativePath: string
			absolutePath: string
			before: string
			after: string
			skipped?: boolean
			reason?: string
		}>
	> {
		const cacheKey = `diff:${fromHash}:${toHash}`
		const cached = this.cache.get<any[]>(cacheKey)
		if (cached) {
			return cached
		}

		// 获取变更的文件列表
		const summary = await this.git.diffSummary([fromHash, toHash])
		const result = []
		let totalSize = 0

		// 并发获取文件内容
		const promises = summary.files.map((file) =>
			this.limiter(async () => {
				const relativePath = PathUtils.normalizePath(file.file)
				const absolutePath = PathUtils.handleLongPath(relativePath)

				// 检查文件大小
				try {
					const stats = await this.git.raw(["ls-tree", "-l", toHash, file.file])
					const size = parseInt(stats.split(/\s+/)[3], 10)

					if (size > this.MAX_FILE_SIZE) {
						return {
							relativePath,
							absolutePath,
							before: "",
							after: "",
							skipped: true,
							reason: "文件过大，已跳过差异比较",
						}
					}

					if (totalSize + size > this.MAX_TOTAL_SIZE) {
						return {
							relativePath,
							absolutePath,
							before: "",
							after: "",
							skipped: true,
							reason: "累计差异过大，已跳过比较",
						}
					}

					totalSize += size
				} catch (error) {
					// 如果无法获取文件大小，继续处理
				}

				let before = ""
				let after = ""

				// 检查文件是否有实际变更
				if (!file.binary) {
					try {
						before = await this.git.show([`${fromHash}:${file.file}`])
					} catch (error) {
						// 文件在 fromHash 中不存在
					}

					try {
						after = await this.git.show([`${toHash}:${file.file}`])
					} catch (error) {
						// 文件在 toHash 中不存在
					}
				}

				return {
					relativePath,
					absolutePath,
					before,
					after,
				}
			}),
		)

		const diffs = await Promise.all(promises)
		result.push(...diffs)

		// 缓存结果
		this.cache.set(cacheKey, result)

		return result
	}

	/**
	 * 计算增量差异
	 * 只处理实际变更的部分
	 */
	async computeIncrementalDiff(
		baseHash: string,
		targetHash: string,
		lastKnownHash?: string,
	): Promise<
		Array<{
			relativePath: string
			absolutePath: string
			before: string
			after: string
			skipped?: boolean
			reason?: string
		}>
	> {
		// 如果有上一次的哈希，计算增量差异
		if (lastKnownHash) {
			const incrementalChanges = await this.git.diffSummary([lastKnownHash, targetHash])
			if (incrementalChanges.files.length > 0) {
				// 有变化，计算增量差异
				return this.computeDiff(lastKnownHash, targetHash)
			}
			// 没有变化，返回缓存的结果
			const cacheKey = `diff:${baseHash}:${lastKnownHash}`
			const cached = this.cache.get<any[]>(cacheKey)
			if (cached) {
				return cached
			}
		}

		// 如果没有增量信息或缓存，计算完整差异
		return this.computeDiff(baseHash, targetHash)
	}

	/**
	 * 在创建检查点后预热缓存
	 * @param newHash 新创建的检查点哈希
	 * @param previousHash 前一个检查点的哈希
	 */
	async warmupAfterCreate(newHash: string, previousHash?: string): Promise<void> {
		if (previousHash) {
			const cacheKey = `diff:${previousHash}:${newHash}`
			if (!this.cache.get(cacheKey)) {
				await this.computeDiff(previousHash, newHash)
			}
		}
	}

	/**
	 * 在恢复检查点时预热缓存
	 * @param targetHash 目标检查点哈希
	 * @param currentHash 当前检查点哈希
	 */
	async warmupAfterRestore(targetHash: string, currentHash: string): Promise<void> {
		const cacheKey = `diff:${targetHash}:${currentHash}`
		if (!this.cache.get(cacheKey)) {
			// 在后台进行预热，不阻塞主流程
			this.limiter(async () => {
				await this.computeDiff(targetHash, currentHash)
			})
		}
	}

	/**
	 * 预热缓存
	 * 只预热相邻提交的差异
	 * @deprecated 使用 warmupAfterCreate 和 warmupAfterRestore 代替
	 */
	async warmupCache(commits: string[]): Promise<void> {
		const tasks = []
		// 只预热相邻提交的差异
		for (let i = 0; i < commits.length - 1; i++) {
			const fromHash = commits[i]
			const toHash = commits[i + 1]
			const cacheKey = `diff:${fromHash}:${toHash}`

			if (!this.cache.get(cacheKey)) {
				tasks.push(
					this.limiter(async () => {
						await this.computeDiff(fromHash, toHash)
					}),
				)
			}
		}

		await Promise.all(tasks)
	}

	/**
	 * 清理过期的缓存
	 */
	clearExpiredCache(): void {
		this.cache.clearExpired()
	}
}
