import defaultShell from "default-shell"
import os from "os"
import osName from "os-name"
import { Mode, ModeConfig, getModeBySlug, defaultModeSlug, isToolAllowedForMode } from "../../../shared/modes"
import { getShell, getSystemInfo } from "../../../utils/shell"

/*
这个getSystemInfoSection函数的主要作用是：
生成一个包含系统信息的提示词部分，作为大型语言模型（如GPT或Claude）的系统提示的一部分
提供给AI模型关于用户系统环境的重要信息，包括：
操作系统类型
默认shell
用户主目录
当前工作目录
函数还包含了一段说明文字，告诉AI模型：
用户初次提交任务时会包含当前工作目录的所有文件路径列表
这些文件路径信息有助于理解项目结构和组织方式
如何使用list_files工具来进一步探索目录结构
这些信息对于AI助手了解用户的操作环境和项目上下文非常重要，有助于提供更准确、更相关的代码建议和帮助。
*/
export function getSystemInfoSection(cwd: string, currentMode: Mode, customModes?: ModeConfig[]): string {
	const findModeBySlug = (slug: string, modes?: ModeConfig[]) => modes?.find((m) => m.slug === slug)

	const currentModeName = findModeBySlug(currentMode, customModes)?.name || currentMode
	const codeModeName = findModeBySlug(defaultModeSlug, customModes)?.name || "Code"

	const systemInfo = getSystemInfo()

	let details = `====

SYSTEM INFORMATION

Operating System: ${systemInfo.os}
Default Shell: ${systemInfo.shell}
Home Directory: ${systemInfo.homeDir.toPosix()}
Current Working Directory: ${cwd.toPosix()}

When the user initially gives you a task, a recursive list of all filepaths in the current working directory ('/test/path') will be included in environment_details. This provides an overview of the project's file structure, offering key insights into the project from directory/file names (how developers conceptualize and organize their code) and file extensions (the language used). This can also guide decision-making on which files to explore further. If you need to further explore directories such as outside the current working directory, you can use the list_files tool. If you pass 'true' for the recursive parameter, it will list files recursively. Otherwise, it will list files at the top level, which is better suited for generic directories where you don't necessarily need the nested structure, like the Desktop.`

	return details
}
