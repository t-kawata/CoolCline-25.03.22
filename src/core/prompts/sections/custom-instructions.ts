import fs from "fs/promises"
import { PathUtils } from "../../../services/checkpoints/CheckpointUtils"

/*
这个custom-instructions.ts文件的主要作用是处理用户自定义指令，用于构建提供给AI模型的提示词。具体功能如下：
加载规则文件：
loadRuleFiles函数从工作目录中读取多种规则文件（.coolclinerules、.cursorrules、.windsurfrules）
将这些文件的内容合并为一个字符串
添加自定义指令：
addCustomInstructions函数整合多种自定义指令和规则
处理几种不同类型的指令：
语言偏好设置（如果提供了preferredLanguage）
全局指令（globalCustomInstructions）
模式特定指令（modeCustomInstructions）
模式特定规则（从.coolclinerules-{mode}文件加载）
通用规则（通过loadRuleFiles函数加载）
格式化输出：
将所有指令和规则组织成结构化的部分
添加清晰的标题（如"Global Instructions"、"Mode-specific Instructions"、"Rules"）
生成最终的提示词部分，标记为"USER'S CUSTOM INSTRUCTIONS"
这个文件的作用是让用户能够通过各种配置文件自定义AI助手的行为，比如设置首选语言、添加特定的工作规则或针对不同模式的自定义行为。
这些指令和规则会被添加到AI模型的系统提示中，从而影响AI助手如何理解和响应用户请求。
*/
export async function loadRuleFiles(cwd: string): Promise<string> {
	const ruleFiles = [".coolclinerules", ".cursorrules", ".windsurfrules"]
	let combinedRules = ""

	for (const file of ruleFiles) {
		try {
			const content = await fs.readFile(PathUtils.joinPath(cwd, file), "utf-8")
			if (content.trim()) {
				combinedRules += `\n# Rules from ${file}:\n${content.trim()}\n`
			}
		} catch (err) {
			// Silently skip if file doesn't exist
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err
			}
		}
	}

	return combinedRules
}

export async function addCustomInstructions(
	modeCustomInstructions: string,
	globalCustomInstructions: string,
	cwd: string,
	mode: string,
): Promise<string> {
	const sections = []

	// Load mode-specific rules if mode is provided
	let modeRuleContent = ""
	if (mode) {
		try {
			const modeRuleFile = `.coolclinerules-${mode}`
			const content = await fs.readFile(PathUtils.joinPath(cwd, modeRuleFile), "utf-8")
			if (content.trim()) {
				modeRuleContent = content.trim()
			}
		} catch (err) {
			// Silently skip if file doesn't exist
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err
			}
		}
	}

	// Add global instructions first
	if (typeof globalCustomInstructions === "string" && globalCustomInstructions.trim()) {
		sections.push(`Global Instructions:\n${globalCustomInstructions.trim()}`)
	}

	// Add mode-specific instructions after
	if (typeof modeCustomInstructions === "string" && modeCustomInstructions.trim()) {
		sections.push(`Mode-specific Instructions:\n${modeCustomInstructions.trim()}`)
	}

	// Add rules - include both mode-specific and generic rules if they exist
	const rules = []

	// Add mode-specific rules first if they exist
	if (modeRuleContent && modeRuleContent.trim()) {
		const modeRuleFile = `.coolclinerules-${mode}`
		rules.push(`# Rules from ${modeRuleFile}:\n${modeRuleContent}`)
	}

	// Add generic rules
	const genericRuleContent = await loadRuleFiles(cwd)
	if (genericRuleContent && genericRuleContent.trim()) {
		rules.push(genericRuleContent.trim())
	}

	if (rules.length > 0) {
		sections.push(`Rules:\n\n${rules.join("\n\n")}`)
	}

	const joinedSections = sections.join("\n\n")

	return joinedSections
		? `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.

${joinedSections}`
		: ""
}
