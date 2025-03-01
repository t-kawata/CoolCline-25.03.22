export interface ModelInfo {
	id: string
	name?: string
	description?: string
	displayName?: string
	contextWindow?: number
	maxTokens?: number
	supportsImages?: boolean
	supportsComputerUse?: boolean
	supportsPromptCache?: boolean
	pricing?: {
		prompt?: number
		completion?: number
		cacheWritesPrice?: number
		cacheReadsPrice?: number
	}
	reasoningEffort?: "low" | "medium" | "high"
	modelUrl?: string
	[key: string]: any
}

export interface SearchModelPickerProps {
	// 基础配置
	value: string
	onValueChange: (value: string) => void
	// 数据源配置
	models: Record<string, ModelInfo>
	defaultModelId?: string
	// 展示配置
	label?: string
	placeholder?: string
	disabled?: boolean
	// 搜索配置
	searchFields?: string[] // 指定要搜索的字段，默认 ['id', 'name']
	// 刷新配置
	onRefreshModels?: () => void
	autoRefresh?: boolean // 是否自动刷新
	// 展示配置
	showModelInfo?: boolean // 是否显示模型信息
	customModelInfo?: (model: ModelInfo) => React.ReactNode // 自定义模型信息展示
	// 样式配置
	maxDropdownHeight?: number
	className?: string
	style?: React.CSSProperties
	// 空结果配置
	emptyMessage?: string
	// API 配置
	onUpdateConfig?: (config: any) => void
}

export interface SearchableModel extends ModelInfo {
	searchText: string // 用于搜索的文本
	displayHtml: string // 用于显示的 HTML
}
