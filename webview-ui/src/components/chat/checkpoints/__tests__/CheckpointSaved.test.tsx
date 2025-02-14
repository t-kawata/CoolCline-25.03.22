import { render, screen } from "@testing-library/react"
import { CheckpointSaved } from "../CheckpointSaved"

jest.mock("../CheckpointMenu", () => ({
	CheckpointMenu: () => <div data-testid="checkpoint-menu" />,
}))

describe("CheckpointSaved", () => {
	const props = {
		ts: 1234567890,
		commitHash: "abc123",
	}

	it("renders checkpoint icon and text", () => {
		render(<CheckpointSaved {...props} />)

		expect(screen.getByText("Checkpoint")).toBeInTheDocument()
		const icon = screen.getByTestId("git-commit-icon")
		expect(icon).toHaveClass("text-blue-400")
	})

	it("renders checkpoint menu", () => {
		render(<CheckpointSaved {...props} />)
		expect(screen.getByTestId("checkpoint-menu")).toBeInTheDocument()
	})
})
