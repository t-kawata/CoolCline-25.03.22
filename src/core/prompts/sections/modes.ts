import * as vscode from "vscode"
import { promises as fs } from "fs"
import { modes, ModeConfig } from "../../../shared/modes"
import { PathUtils } from "../../../services/checkpoints/CheckpointUtils"

/*
modes.ts 是系统提示词中关于模式（Modes）配置的说明部分，它主要定义了：
模式的基本概念：
内置模式（Built-in modes）的展示名称
自定义模式（Custom modes）的配置方式
自定义模式的配置要求：
必需字段：
slug：唯一标识符（小写字母、数字和连字符）
name：显示名称
roleDefinition：模式的角色和能力详细描述
groups：允许使用的工具组列表
可选字段：
customInstructions：额外的模式特定指令
工具组配置方式：
简单配置：直接使用字符串（如 "edit"）
高级配置：使用数组形式，可以包含文件限制
Apply
]
配置存储位置：
自定义模式配置文件存储在 coolcline_custom_modes.json
文件在启动时自动创建
示例配置：
提供了一个"Designer"模式的完整配置示例
展示了如何配置工具组和角色定义
这个文件的主要作用是：
指导 AI 如何理解和处理不同的模式
定义模式配置的标准格式
确保模式配置的一致性和完整性
提供清晰的配置示例和说明
它是系统提示词中关于模式管理的重要部分，帮助 AI 理解和使用不同的工作模式。
*/

export async function getModesSection(context: vscode.ExtensionContext): Promise<string> {
	const settingsDir = PathUtils.joinPath(context.globalStorageUri.fsPath, "settings")
	await fs.mkdir(settingsDir, { recursive: true })
	const customModesPath = PathUtils.joinPath(settingsDir, "coolcline_custom_modes.json")

	return `====

MODES

- When referring to modes, always use their display names. The built-in modes are:
${modes.map((mode: ModeConfig) => `  * "${mode.name}" mode - ${mode.roleDefinition.split(".")[0]}`).join("\n")}
  Custom modes will be referred to by their configured name property.

- Custom modes can be configured by editing the custom modes file at '${customModesPath}'. The file gets created automatically on startup and should always exist. Make sure to read the latest contents before writing to it to avoid overwriting existing modes.

- The following fields are required and must not be empty:
  * slug: A valid slug (lowercase letters, numbers, and hyphens). Must be unique, and shorter is better.
  * name: The display name for the mode
  * roleDefinition: A detailed description of the mode's role and capabilities
  * groups: Array of allowed tool groups (can be empty). Each group can be specified either as a string (e.g., "edit" to allow editing any file) or with file restrictions (e.g., ["edit", { fileRegex: "\\.md$", description: "Markdown files only" }] to only allow editing markdown files)

- The customInstructions field is optional.

- For multi-line text, include newline characters in the string like "This is the first line.\nThis is the next line.\n\nThis is a double line break."

The file should follow this structure:
{
 "customModes": [
   {
     "slug": "designer", // Required: unique slug with lowercase letters, numbers, and hyphens
     "name": "Designer", // Required: mode display name
     "roleDefinition": "You are CoolCline, a UI/UX expert specializing in design systems and frontend development. Your expertise includes:\n- Creating and maintaining design systems\n- Implementing responsive and accessible web interfaces\n- Working with CSS, HTML, and modern frontend frameworks\n- Ensuring consistent user experiences across platforms", // Required: non-empty
     "groups": [ // Required: array of tool groups (can be empty)
       "read",    // Read files group (read_file, search_files, list_files, list_code_definition_names)
       "edit",    // Edit files group (write_to_file, apply_diff) - allows editing any file
       // Or with file restrictions:
       // ["edit", { fileRegex: "\\.md$", description: "Markdown files only" }],  // Edit group that only allows editing markdown files
       "browser", // Browser group (browser_action)
       "command", // Command group (execute_command)
       "mcp"     // MCP group (use_mcp_tool, access_mcp_resource)
     ],
     "customInstructions": "Additional instructions for the Designer mode" // Optional
    }
  ]
}`
}
