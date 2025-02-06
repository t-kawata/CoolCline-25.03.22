import { render, fireEvent, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import ChatTextArea from "../ChatTextArea"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { vscode } from "../../../utils/vscode"
import { defaultModeSlug } from "../../../../../src/shared/modes"

// Mock modules
jest.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))
jest.mock("../../../components/common/CodeBlock")
jest.mock("../../../components/common/MarkdownBlock")

// Get the mocked postMessage function
const mockPostMessage = vscode.postMessage as jest.Mock

// Mock ExtensionStateContext
jest.mock("../../../context/ExtensionStateContext")

describe("ChatTextArea", () => {
	const defaultProps = {
		inputValue: "",
		setInputValue: jest.fn(),
		onSend: jest.fn(),
		textAreaDisabled: false,
		onSelectImages: jest.fn(),
		shouldDisableImages: false,
		placeholderText: "Type a message...",
		selectedImages: [],
		setSelectedImages: jest.fn(),
		onHeightChange: jest.fn(),
		mode: defaultModeSlug,
		setMode: jest.fn(),
	}

	beforeEach(() => {
		jest.clearAllMocks()
		// Default mock implementation for useExtensionState
		;(useExtensionState as jest.Mock).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			apiConfiguration: {
				apiProvider: "anthropic",
			},
		})
	})

	describe("enhance prompt button", () => {
		it("should be disabled when textAreaDisabled is true", () => {
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
			})

			render(<ChatTextArea {...defaultProps} textAreaDisabled={true} />)
			const enhanceButton = screen.getByRole("button", { name: /enhance prompt/i })
			expect(enhanceButton).toHaveClass("disabled")
		})
	})

	describe("handleEnhancePrompt", () => {
		it("should send message with correct configuration when clicked", () => {
			const apiConfiguration = {
				apiProvider: "openrouter",
				apiKey: "test-key",
			}

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration,
			})

			render(<ChatTextArea {...defaultProps} inputValue="Test prompt" />)

			const enhanceButton = screen.getByRole("button", { name: /enhance prompt/i })
			fireEvent.click(enhanceButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "enhancePrompt",
				text: "Test prompt",
			})
		})

		it("should not send message when input is empty", () => {
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
				},
			})

			render(<ChatTextArea {...defaultProps} inputValue="" />)

			const enhanceButton = screen.getByRole("button", { name: /enhance prompt/i })
			fireEvent.click(enhanceButton)

			expect(mockPostMessage).not.toHaveBeenCalled()
		})

		it("should show loading state while enhancing", () => {
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
				},
			})

			render(<ChatTextArea {...defaultProps} inputValue="Test prompt" />)

			const enhanceButton = screen.getByRole("button", { name: /enhance prompt/i })
			fireEvent.click(enhanceButton)

			const loadingSpinner = screen.getByText("", { selector: ".codicon-loading" })
			expect(loadingSpinner).toBeInTheDocument()
		})
	})

	describe("effect dependencies", () => {
		it("should update when apiConfiguration changes", () => {
			const { rerender } = render(<ChatTextArea {...defaultProps} />)

			// Update apiConfiguration
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
					newSetting: "test",
				},
			})

			rerender(<ChatTextArea {...defaultProps} />)

			// Verify the enhance button appears after apiConfiguration changes
			expect(screen.getByRole("button", { name: /enhance prompt/i })).toBeInTheDocument()
		})
	})

	describe("enhanced prompt response", () => {
		it("should update input value when receiving enhanced prompt", () => {
			const setInputValue = jest.fn()

			render(<ChatTextArea {...defaultProps} setInputValue={setInputValue} />)

			// Simulate receiving enhanced prompt message
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "enhancedPrompt",
						text: "Enhanced test prompt",
					},
				}),
			)

			expect(setInputValue).toHaveBeenCalledWith("Enhanced test prompt")
		})
	})

	describe("mode switching with slash command", () => {
		it("should show mode list when typing slash", () => {
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			render(<ChatTextArea {...defaultProps} />)
			const textarea = screen.getByRole("textbox")

			fireEvent.change(textarea, { target: { value: "/" } })

			// 在上下文菜单中查找包含 Test Mode 的选项
			const menuOptions = screen.getAllByTestId(/^context-menu-option-/)
			const testModeOption = menuOptions.find((option) => option.textContent?.includes("Test Mode"))
			expect(testModeOption).toBeTruthy()
			expect(testModeOption).toHaveTextContent("Test role definition")
		})

		it("should filter modes when typing after slash", () => {
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
				{
					slug: "other-mode",
					name: "Other Mode",
					roleDefinition: "Other role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			render(<ChatTextArea {...defaultProps} />)
			const textarea = screen.getByRole("textbox")

			fireEvent.change(textarea, { target: { value: "/test" } })

			// 验证过滤结果
			const menuOptions = screen.getAllByTestId(/^context-menu-option-/)
			const testModeOption = menuOptions.find((option) => option.textContent?.includes("Test Mode"))
			const otherModeOption = menuOptions.find((option) => option.textContent?.includes("Other Mode"))

			expect(testModeOption).toBeTruthy()
			expect(otherModeOption).toBeFalsy()
		})

		it("should switch mode when selecting from list", async () => {
			const setMode = jest.fn()
			const setInputValue = jest.fn()
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			render(<ChatTextArea {...defaultProps} setMode={setMode} setInputValue={setInputValue} />)
			const textarea = screen.getByRole("textbox")

			// 输入斜杠显示模式列表
			fireEvent.change(textarea, { target: { value: "/" } })

			// 选择 Test Mode
			const testModeOption = screen.getByTestId("context-menu-option-3")
			fireEvent.click(testModeOption)

			// 验证模式切换
			expect(setMode).toHaveBeenCalledWith("test-mode")
			expect(setInputValue).toHaveBeenCalledWith("")
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "mode",
				text: "test-mode",
			})

			// 验证上下文菜单已关闭
			expect(screen.queryByTestId("context-menu-option-3")).toBeNull()
		})

		it("should clear input after switching mode", () => {
			const setMode = jest.fn()
			const setInputValue = jest.fn()
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			render(<ChatTextArea {...defaultProps} setMode={setMode} setInputValue={setInputValue} />)
			const textarea = screen.getByRole("textbox")

			fireEvent.change(textarea, { target: { value: "/" } })

			const menuOptions = screen.getAllByTestId(/^context-menu-option-/)
			const testModeOption = menuOptions.find((option) => option.textContent?.includes("Test Mode"))
			fireEvent.click(testModeOption!)

			expect(setInputValue).toHaveBeenCalledWith("")
		})

		it("should hide mode list when input is not a slash command", () => {
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			render(<ChatTextArea {...defaultProps} />)
			const textarea = screen.getByRole("textbox")

			// 先显示模式列表
			fireEvent.change(textarea, { target: { value: "/" } })
			expect(screen.getAllByTestId(/^context-menu-option-/)).not.toHaveLength(0)

			// 输入非斜杠命令文本
			fireEvent.change(textarea, { target: { value: "hello" } })
			expect(screen.queryByTestId(/^context-menu-option-/)).toBeNull()
		})

		it("should handle empty customModes gracefully", () => {
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes: [],
			})

			render(<ChatTextArea {...defaultProps} />)
			const textarea = screen.getByRole("textbox")

			fireEvent.change(textarea, { target: { value: "/" } })

			// 应该显示默认的模式选项
			const menuOptions = screen.getAllByTestId(/^context-menu-option-/)
			expect(menuOptions.length).toBeGreaterThan(0)
			expect(menuOptions[0]).toHaveTextContent(/Code|Architect|Ask/)
		})

		it("should handle fuzzy search with partial mode name", () => {
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
				{
					slug: "test-mode-2",
					name: "Another Test Mode",
					roleDefinition: "Another test role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			render(<ChatTextArea {...defaultProps} />)
			const textarea = screen.getByRole("textbox")

			// 使用模糊搜索
			fireEvent.change(textarea, { target: { value: "/tst" } })

			const menuOptions = screen.getAllByTestId(/^context-menu-option-/)
			expect(menuOptions.some((option) => option.textContent?.includes("Test Mode"))).toBeTruthy()
			expect(menuOptions.some((option) => option.textContent?.includes("Another Test Mode"))).toBeTruthy()
		})

		it("should update bottom mode selector after switching mode via slash command", async () => {
			const setMode = jest.fn()
			const setInputValue = jest.fn()
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			const { rerender } = render(
				<ChatTextArea {...defaultProps} setMode={setMode} setInputValue={setInputValue} mode="code" />,
			)

			const textarea = screen.getByRole("textbox")

			// 输入斜杠显示模式列表
			fireEvent.change(textarea, { target: { value: "/" } })

			// 选择 Test Mode
			const testModeOption = screen.getByTestId("context-menu-option-3")
			fireEvent.click(testModeOption)

			// 等待模式切换
			expect(setMode).toHaveBeenCalledWith("test-mode")
			expect(setInputValue).toHaveBeenCalledWith("")

			// 重新渲染组件以反映新的模式
			rerender(
				<ChatTextArea {...defaultProps} setMode={setMode} setInputValue={setInputValue} mode="test-mode" />,
			)

			// 验证底部选择器已更新
			const bottomModeSelector = screen.getAllByRole("combobox")[0]
			expect(bottomModeSelector).toHaveValue("test-mode")
		})

		it("should sync mode changes between slash command and bottom selector", async () => {
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			render(<ChatTextArea {...defaultProps} />)

			// 获取底部的模式选择器
			const bottomModeSelector = screen.getAllByRole("combobox")[0]

			// 通过底部选择器切换模式
			fireEvent.change(bottomModeSelector, { target: { value: "test-mode" } })

			// 验证 vscode 消息是否发送
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "mode",
				text: "test-mode",
			})

			// 通过斜杠命令切换回默认模式
			const textarea = screen.getByRole("textbox")
			fireEvent.change(textarea, { target: { value: "/" } })
			const menuOptions = screen.getAllByTestId(/^context-menu-option-/)
			const codeOption = menuOptions.find((option) => option.textContent?.includes("Code"))
			fireEvent.click(codeOption!)

			// 验证底部选择器是否同步更新
			expect(bottomModeSelector).toHaveValue("code")
			expect(mockPostMessage).toHaveBeenLastCalledWith({
				type: "mode",
				text: "code",
			})
		})

		it("should trigger same side effects when switching mode via either method", async () => {
			const setMode = jest.fn()
			const setInputValue = jest.fn()
			const customModes = [
				{
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role definition",
					groups: ["read"],
				},
			]

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				customModes,
			})

			render(<ChatTextArea {...defaultProps} setMode={setMode} setInputValue={setInputValue} />)

			// 通过底部选择器切换模式
			const bottomModeSelector = screen.getAllByRole("combobox")[0]
			fireEvent.change(bottomModeSelector, { target: { value: "test-mode" } })

			// 验证副作用
			expect(setMode).toHaveBeenCalledWith("test-mode")
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "mode",
				text: "test-mode",
			})

			// 重置 mock
			setMode.mockClear()
			mockPostMessage.mockClear()

			// 通过斜杠命令切换模式
			const textarea = screen.getByRole("textbox")
			fireEvent.change(textarea, { target: { value: "/" } })
			const menuOptions = screen.getAllByTestId(/^context-menu-option-/)
			const testModeOption = menuOptions.find((option) => option.textContent?.includes("Test Mode"))
			fireEvent.click(testModeOption!)

			// 验证相同的副作用
			expect(setMode).toHaveBeenCalledWith("test-mode")
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "mode",
				text: "test-mode",
			})
		})
	})
})
