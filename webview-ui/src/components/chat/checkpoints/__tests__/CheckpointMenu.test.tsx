import { render, screen, fireEvent, within } from "@testing-library/react"
import { CheckpointMenu } from "../CheckpointMenu"
import { vscode } from "../../../../utils/vscode"

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
			payload: { ts: props.ts, commitHash: props.commitHash, mode: "restore" },
		})
	})
})
