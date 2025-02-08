// 由于大语言模型不能一次性翻译整个文件，建议同步后让大语言增量翻译
// 用于同步 en.json 文件到其他语言的文件，并删除空行
// 注意它不会翻译，只是同步字段
// 同步后每个文件再进行翻译
const fs = require("fs")
const path = require("path")

// 统计文件行数的函数
function countLines(filePath) {
	const content = fs.readFileSync(filePath, "utf8")
	return content.split("\n").length
}

// 读取基准文件（en.json）并删除空行
const enJsonPath = path.join(__dirname, "assets/i18n/en.json")
const baseFileContent = fs
	.readFileSync(enJsonPath, "utf8")
	.split("\n")
	.filter((line) => line.trim() !== "") // 删除空行
	.join("\n")

// 格式化并写回 en.json
const baseFile = JSON.parse(baseFileContent)
fs.writeFileSync(enJsonPath, JSON.stringify(baseFile, null, "\t") + "\n")

console.log("✓ Successfully removed empty lines from en.json")

// 获取所有需要同步的文件
const i18nDir = path.join(__dirname, "assets/i18n")
const files = fs.readdirSync(i18nDir).filter((file) => file.endsWith(".json") && file !== "en.json")

// 递归处理对象中的字符串值，移除换行符
function cleanString(str) {
	if (typeof str === "string") {
		return str.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim()
	}
	return str
}

// 递归合并对象，严格保持基准对象的结构和顺序
function mergeObjects(base, target) {
	// 如果不是对象或是数组，直接返回处理后的目标值或基准值
	if (typeof base !== "object" || base === null || Array.isArray(base)) {
		return cleanString(target !== undefined ? target : base)
	}

	// 使用 Map 来保持键的顺序
	const orderedMap = new Map()

	// 首先按基准对象的顺序添加所有键
	Object.keys(base).forEach((key) => {
		if (typeof base[key] === "object" && base[key] !== null && !Array.isArray(base[key])) {
			// 如果是对象，递归合并
			orderedMap.set(key, mergeObjects(base[key], (target && target[key]) || {}))
		} else {
			// 如果是基本类型，使用目标值，如果目标值不存在则使用基准值
			orderedMap.set(key, cleanString(target && target[key] !== undefined ? target[key] : base[key]))
		}
	})

	// 将 Map 转换回对象，保持顺序
	const result = {}
	orderedMap.forEach((value, key) => {
		result[key] = value
	})

	return result
}

// 处理每个文件
console.log("\n文件行数统计：")
console.log(`en.json: ${countLines(enJsonPath)} 行`)

files.forEach((file) => {
	const filePath = path.join(i18nDir, file)
	const beforeLines = countLines(filePath)
	console.log(`Processing ${file}...`)

	try {
		// 读取当前文件
		const currentContent = JSON.parse(fs.readFileSync(filePath, "utf8"))

		// 合并内容，保持基准结构和顺序
		const mergedContent = mergeObjects(baseFile, currentContent)

		// 写回文件，保持格式
		fs.writeFileSync(filePath, JSON.stringify(mergedContent, null, "\t") + "\n")

		const afterLines = countLines(filePath)
		console.log(`✓ Successfully processed ${file} (${beforeLines} -> ${afterLines} 行)`)
	} catch (error) {
		console.error(`Error processing ${file}:`, error)
	}
})
