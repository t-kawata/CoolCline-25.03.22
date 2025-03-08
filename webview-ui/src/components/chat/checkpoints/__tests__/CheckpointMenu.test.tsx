import { render, screen, fireEvent, within } from "@testing-library/react"
import { CheckpointMenu } from "../CheckpointMenu"
import { vscode } from "../../../../utils/vscode"

// Mock vscode module
jest.mock("../../../../utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

describe("CheckpointMenu", () => {
	const props = {
		ts: 1234567890,
		commitHash: "abc123",
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders checkpoint diff button", () => {
		render(<CheckpointMenu {...props} />)
		expect(screen.getByRole("button", { name: "diff" })).toBeInTheDocument()
	})

	it("renders restore button", () => {
		render(<CheckpointMenu {...props} />)
		const restoreButton = screen.getByRole("button", { name: "history" })
		expect(restoreButton).toBeInTheDocument()
	})

	it("shows popover content when clicking restore button", () => {
		render(<CheckpointMenu {...props} />)
		const restoreButton = screen.getByRole("button", { name: "history" })
		fireEvent.click(restoreButton)

		expect(screen.getByRole("button", { name: "Restore Files" })).toBeInTheDocument()
	})

	it("calls checkpoint diff when clicking diff button", () => {
		render(<CheckpointMenu {...props} />)
		const diffButton = screen.getByRole("button", { name: "diff" })
		fireEvent.click(diffButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "checkpointDiff",
			payload: { ts: props.ts, commitHash: props.commitHash, mode: "checkpoint" },
		})
	})

	it("shows confirmation dialog when clicking Restore Files", async () => {
		render(<CheckpointMenu {...props} />)

		// Open history popover
		const historyButton = screen.getByRole("button", { name: "history" })
		fireEvent.click(historyButton)

		// Wait for the popover to be open
		const dialog = await screen.findByRole("dialog")

		// Find and click restore files button (exact match)
		const restoreButton = await within(dialog).findByRole("button", { name: "Restore Files & Task" })
		fireEvent.click(restoreButton)

		// Use button role and name to find confirmation buttons
		const confirmButton = await within(dialog).findByRole("button", { name: /confirm/i })
		const cancelButton = await within(dialog).findByRole("button", { name: /cancel/i })
		const warningText = await within(dialog).findByText(/this action cannot be undone/i)

		expect(confirmButton).toBeInTheDocument()
		expect(cancelButton).toBeInTheDocument()
		expect(warningText).toBeInTheDocument()
	})

	it("calls restore with correct mode when confirming restore", async () => {
		render(<CheckpointMenu {...props} />)

		// Open history popover
		const historyButton = screen.getByRole("button", { name: "history" })
		fireEvent.click(historyButton)

		// Wait for the popover to be open
		const dialog = await screen.findByRole("dialog")

		// Find and click restore files button (exact match)
		const restoreButton = await within(dialog).findByRole("button", { name: "Restore Files & Task" })
		fireEvent.click(restoreButton)

		// Find and click confirm button using button role and name
		const confirmButton = await within(dialog).findByRole("button", { name: /confirm/i })
		fireEvent.click(confirmButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "checkpointRestore",
			payload: { ts: props.ts, commitHash: props.commitHash, mode: "files_and_messages" },
		})
	})

	const defaultProps = {
		ts: 1234567890,
		commitHash: "abc123",
		currentCheckpointHash: "def456",
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should always show history button", () => {
		render(<CheckpointMenu {...defaultProps} />)
		expect(screen.getByText("", { selector: "span.codicon-history" })).toBeInTheDocument()
	})

	it('should show "Restore Files" option only when not current checkpoint', () => {
		const { rerender } = render(<CheckpointMenu {...defaultProps} currentCheckpointHash="xyz789" />)

		// Open popover
		fireEvent.click(screen.getByText("", { selector: "span.codicon-history" }))
		expect(screen.getByText("Restore Files")).toBeInTheDocument()

		// Test with current checkpoint
		rerender(<CheckpointMenu {...defaultProps} currentCheckpointHash="abc123" />)
		expect(screen.queryByText("Restore Files")).not.toBeInTheDocument()
	})

	it('should always show "Restore Files & Task" option', () => {
		render(<CheckpointMenu {...defaultProps} />)
		fireEvent.click(screen.getByText("", { selector: "span.codicon-history" }))
		expect(screen.getByText("Restore Files & Task")).toBeInTheDocument()
	})

	it("should handle confirmation flow correctly", () => {
		render(<CheckpointMenu {...defaultProps} />)
		fireEvent.click(screen.getByText("", { selector: "span.codicon-history" }))

		// Click Restore Files & Task
		fireEvent.click(screen.getByText("Restore Files & Task"))
		expect(screen.getByText("Confirm")).toBeInTheDocument()
		expect(screen.getByText("Cancel")).toBeInTheDocument()
		expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument()

		// Click Cancel
		fireEvent.click(screen.getByText("Cancel"))
		expect(screen.queryByText("Confirm")).not.toBeInTheDocument()
	})
})
