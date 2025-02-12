import { Checkbox } from "vscrui"
import { useEffect, useState } from "react"

interface TemperatureControlProps {
	value: number | undefined
	onChange: (value: number | undefined) => void
	maxValue?: number // Some providers like OpenAI use 0-2 range
}

export const TemperatureControl = ({ value, onChange, maxValue = 1 }: TemperatureControlProps) => {
	const [isCustomTemperature, setIsCustomTemperature] = useState(value !== undefined)

	// Sync internal state with prop changes when switching profiles
	useEffect(() => {
		setIsCustomTemperature(value !== undefined)
	}, [value])

	return (
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
			<Checkbox
				checked={isCustomTemperature}
				onChange={(checked: boolean) => {
					setIsCustomTemperature(checked)
					if (!checked) {
						onChange(undefined) // Reset to provider default
					} else {
						onChange(0) // Set initial value when enabling
					}
				}}>
				<span style={{ fontWeight: 500 }}>使用自定义温度</span>
			</Checkbox>

			{isCustomTemperature && (
				<>
					<i
						className="codicon codicon-info"
						title={`控制模型响应的随机性。较高的值（如0.8）使输出更随机，较低的值（如0.2）使其更确定。范围：0-${maxValue}`}
						style={{
							fontSize: "12px",
							color: "var(--vscode-descriptionForeground)",
							cursor: "help",
						}}
					/>
					<input
						type="range"
						min="0"
						max={maxValue}
						step="0.05"
						value={value}
						onChange={(e) => {
							const newValue = parseFloat(e.target.value)
							onChange(isNaN(newValue) ? undefined : newValue)
						}}
						style={{
							flexGrow: 1,
							accentColor: "var(--vscode-button-background)",
							height: "2px",
						}}
					/>
					<span
						style={{
							fontSize: "12px",
							color: "var(--vscode-descriptionForeground)",
							minWidth: "36px",
							textAlign: "right",
						}}>
						{value?.toFixed(2)}
					</span>
				</>
			)}
		</div>
	)
} 