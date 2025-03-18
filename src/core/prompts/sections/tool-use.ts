/*
tool-use.ts文件中的getSharedToolUseSection函数用于生成系统提示词中关于工具使用的部分。
这个函数返回一段文本，解释了：
AI助手可以使用工具，但需要用户批准
每条消息只能使用一个工具
工具使用的结果会在用户的回复中返回
工具应该逐步使用，每次工具使用都基于前一次的结果
最重要的是，它详细说明了工具使用的格式规范：
工具使用需要使用XML风格的标签
工具名称放在开闭标签中
每个参数也需要放在自己的标签中
提供了一个示例：如何使用read_file工具
在system.ts中，这部分内容通过sections.push(getSharedToolUseSection())被添加到最终的系统提示词中，确保AI助手知道如何正确格式化工具调用。
这是整个系统中非常重要的一部分，因为它定义了AI助手与工具交互的方式，确保工具调用能被正确解析和执行。
*/
export function getSharedToolUseSection(): string {
	return `====

TOOL USE

You have access to a set of tools that are executed upon the user's approval. You can use one tool per message, and will receive the result of that tool use in the user's response. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

# Tool Use Formatting

Tool use is formatted using XML-style tags. The tool name is enclosed in opening and closing tags, and each parameter is similarly enclosed within its own set of tags. Here's the structure:

<tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</tool_name>

For example:

<read_file>
<path>src/main.js</path>
</read_file>

Always adhere to this format for the tool use to ensure proper parsing and execution.`
}
