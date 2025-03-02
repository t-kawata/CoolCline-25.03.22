import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { ModelDescriptionMarkdown } from "./ModelDescriptionMarkdown"
import { ModelInfo } from "./types"
import { formatLargeNumber } from "../../utils/format"

interface ModelInfoViewProps {
	selectedModelId: string
	modelInfo: ModelInfo
	isDescriptionExpanded: boolean
	setIsDescriptionExpanded: (expanded: boolean) => void
}

export const ModelInfoView: React.FC<ModelInfoViewProps> = ({
	selectedModelId,
	modelInfo,
	isDescriptionExpanded,
	setIsDescriptionExpanded,
}) => {
	return (
		<div
			style={{
				marginTop: 8,
				padding: "8px",
				backgroundColor: "var(--vscode-editor-background)",
				border: "1px solid var(--vscode-widget-border)",
				borderRadius: "4px",
				fontSize: "12px",
			}}>
			{/* 描述部分 */}
			{modelInfo.description && (
				<div style={{ marginBottom: "12px" }}>
					<ModelDescriptionMarkdown
						markdown={modelInfo.description}
						modelId={selectedModelId}
						isExpanded={isDescriptionExpanded}
						setIsExpanded={setIsDescriptionExpanded}
					/>
				</div>
			)}

			{/* 信息网格 */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
					gap: "2px",
					marginBottom: "2px",
				}}>
				{/* 基本信息 */}
				{modelInfo.supportsImages !== undefined && (
					<div>supportsImages: {modelInfo.supportsImages ? "yes" : "no"}</div>
				)}
				{modelInfo.supportsComputerUse !== undefined && (
					<div>supportsComputerUse: {modelInfo.supportsComputerUse ? "yes" : "no"}</div>
				)}

				{modelInfo.supportsPromptCache !== undefined && (
					<div>supportsPromptCache: {modelInfo.supportsPromptCache ? "yes" : "no"}</div>
				)}
				{modelInfo.contextWindow && (
					<div>contextWindow: {formatLargeNumber(modelInfo.contextWindow)} tokens</div>
				)}
				{modelInfo.maxTokens && <div>maxTokens: {formatLargeNumber(modelInfo.maxTokens)} tokens</div>}
			</div>

			{/* 价格信息 */}
			{modelInfo.pricing && (
				<div style={{ marginBottom: "4px" }}>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
							gap: "0px",
							marginTop: "0px",
							marginLeft: "0px",
						}}>
						{modelInfo.pricing.prompt !== undefined && (
							<div>inputPrice: ${modelInfo.pricing.prompt.toFixed(3)}/M tokens</div>
						)}
						{modelInfo.pricing.completion !== undefined && (
							<div>outputPrice: ${modelInfo.pricing.completion.toFixed(3)}/M tokens</div>
						)}
						{modelInfo.pricing.cacheWritesPrice !== undefined && (
							<div>cacheWrites: ${modelInfo.pricing.cacheWritesPrice.toFixed(3)}/M tokens</div>
						)}
						{modelInfo.pricing.cacheReadsPrice !== undefined && (
							<div>cacheReads: ${modelInfo.pricing.cacheReadsPrice.toFixed(3)}/M tokens</div>
						)}
					</div>
				</div>
			)}

			{/* 链接 */}
			{modelInfo.modelUrl && (
				<div>
					<VSCodeLink href={modelInfo.modelUrl} style={{ fontSize: "inherit" }}>
						see more
					</VSCodeLink>
				</div>
			)}
		</div>
	)
}
