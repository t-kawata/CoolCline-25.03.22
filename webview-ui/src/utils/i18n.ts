import i18n from "i18next"
import { initReactI18next } from "react-i18next"

// 导入语言资源
import en from "../../../assets/i18n/en.json"
import zhCN from "../../../assets/i18n/zh.json"

declare module "i18next" {
	interface CustomTypeOptions {
		resources: {
			en: typeof en
			"zh-CN": typeof zhCN
		}
	}
}

// 语言代码映射
const languageMap: { [key: string]: string } = {
	English: "en",
	"Simplified Chinese": "zh-CN",
	"中文（简体）": "zh-CN",
	"English (US)": "en",
	en: "en",
	"zh-CN": "zh-CN",
}

// 显示名称映射
const displayMap: { [key: string]: string } = {
	en: "English",
	"zh-CN": "中文（简体）",
	English: "English",
	"Simplified Chinese": "中文（简体）",
}

// 获取语言代码
export function getLanguageCode(language: string): string {
	return languageMap[language] || "en"
}

// 获取显示语言名称
export function getDisplayLanguage(code: string): string {
	return displayMap[code] || "English"
}

// 初始化 i18next
i18n.use(initReactI18next).init({
	resources: {
		en: { translation: en },
		"zh-CN": { translation: zhCN },
	},
	lng: "en",
	fallbackLng: "en",
	interpolation: {
		escapeValue: false,
	},
})

// 切换语言
export function changeLanguage(language: string) {
	const langCode = getLanguageCode(language)
	if (langCode && i18n.languages.includes(langCode)) {
		i18n.changeLanguage(langCode)
		return langCode
	}
	return null
}

export default i18n
