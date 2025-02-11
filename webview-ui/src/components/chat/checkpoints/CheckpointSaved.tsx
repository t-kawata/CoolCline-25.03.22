import { CheckpointMenu } from "./CheckpointMenu"

type CheckpointSavedProps = {
	ts: number
	commitHash: string
}

export const CheckpointSaved = (props: CheckpointSavedProps) => (
	<div className="flex items-center justify-between">
		<div className="flex items-center gap-2">
			<span className="codicon codicon-git-commit" />
			<span className="font-bold">检查点</span>
		</div>
		<CheckpointMenu {...props} />
	</div>
)
