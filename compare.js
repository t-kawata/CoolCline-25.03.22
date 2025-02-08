// 用于比较 en.json 和 ru.json 的差异
const en = require("./assets/i18n/en.json")
const ru = require("./assets/i18n/ru.json")

function getAllPaths(obj, parentPath = "") {
	let paths = new Set()
	for (const key in obj) {
		const currentPath = parentPath ? `${parentPath}.${key}` : key
		paths.add(currentPath)
		if (typeof obj[key] === "object" && obj[key] !== null) {
			const childPaths = getAllPaths(obj[key], currentPath)
			childPaths.forEach((path) => paths.add(path))
		}
	}
	return paths
}

const enPaths = getAllPaths(en)
const ruPaths = getAllPaths(ru)

console.log("Paths in en.json but not in ru.json:")
for (const path of enPaths) {
	if (!ruPaths.has(path)) {
		console.log(path)
	}
}

console.log("\nPaths in ru.json but not in en.json:")
for (const path of ruPaths) {
	if (!enPaths.has(path)) {
		console.log(path)
	}
}
