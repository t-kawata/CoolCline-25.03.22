import { useState, useEffect, useCallback, useRef } from "react"
import { useClickAway, useEvent } from "react-use"
import { useFloating, offset, flip, shift } from "@floating-ui/react"
import { createPortal } from "react-dom"
import styled from "styled-components"
import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons"
import { vscode } from "../../../utils/vscode"
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui"
import { ConfirmDialog } from "../../ui/ConfirmDialog"
import { CheckpointMode, CheckpointRestoreMode } from "../../../../../src/services/checkpoints/types"

type CheckpointMenuProps = {
	ts: number
	commitHash: string
	currentCheckpointHash?: string
	type?: CheckpointMode
	restoreMode?: CheckpointRestoreMode
}

export const CheckpointMenu = ({
	ts,
	commitHash,
	currentCheckpointHash,
	type = "create" as CheckpointMode,
	restoreMode,
}: CheckpointMenuProps) => {
	const [compareDisabled, setCompareDisabled] = useState(false)
	const [restoreDisabled, setRestoreDisabled] = useState(false)
	const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
	const [showCompareConfirm, setShowCompareConfirm] = useState(false)
	const [showConfirmDialog, setShowConfirmDialog] = useState(false)
	const [confirmDialogConfig, setConfirmDialogConfig] = useState<{
		title: string
		description: string
		onConfirm: () => void
	}>({ title: "", description: "", onConfirm: () => {} })
	const [hasMouseEntered, setHasMouseEntered] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const tooltipRef = useRef<HTMLDivElement | null>(null)
	const buttonRef = useRef<HTMLDivElement | null>(null)

	const { refs, floatingStyles, update, placement } = useFloating({
		placement: "bottom-end",
		middleware: [
			offset({
				mainAxis: 8,
				crossAxis: 10,
			}),
			flip(),
			shift(),
		],
	})

	useEffect(() => {
		const handleScroll = () => {
			update()
		}
		window.addEventListener("scroll", handleScroll, true)
		return () => window.removeEventListener("scroll", handleScroll, true)
	}, [update])

	useEffect(() => {
		if (showRestoreConfirm) {
			update()
		}
	}, [showRestoreConfirm, update])

	const handleMessage = useCallback((event: MessageEvent) => {
		const message = event.data
		if (message.type === "relinquishControl") {
			setCompareDisabled(false)
			setRestoreDisabled(false)
			setShowRestoreConfirm(false)
		}
	}, [])

	useEvent("message", handleMessage)

	const handleRestoreClick = () => {
		setConfirmDialogConfig({
			title: "Warning",
			description:
				"This action will restore this change and all changes after it, and delete all related messages. This cannot be undone. Are you sure you want to continue?",
			onConfirm: () => {
				setRestoreDisabled(true)
				vscode.postMessage({
					type: "checkpointRestore",
					payload: {
						ts,
						commitHash,
						mode: "restore_this_and_after_change" as CheckpointRestoreMode,
					},
				})
			},
		})
		setShowConfirmDialog(true)
	}

	const handleUndoRestore = () => {
		setConfirmDialogConfig({
			title: "Warning",
			description:
				"This action will undo the restore operation. This cannot be undone. Are you sure you want to continue?",
			onConfirm: () => {
				setRestoreDisabled(true)
				vscode.postMessage({
					type: "checkpointRestore",
					payload: {
						ts,
						commitHash,
						mode: "undo_restore" as CheckpointRestoreMode,
					},
				})
			},
		})
		setShowConfirmDialog(true)
	}

	const handleCompareThisChange = () => {
		setCompareDisabled(true)
		vscode.postMessage({
			type: "checkpointDiff",
			payload: {
				ts,
				commitHash,
				mode: "checkpoint",
			},
		})
		setShowCompareConfirm(false)
		setTimeout(() => {
			setCompareDisabled(false)
		}, 2000)
	}

	const handleCompareAllChanges = () => {
		setCompareDisabled(true)
		vscode.postMessage({
			type: "checkpointDiff",
			payload: {
				ts,
				commitHash,
				mode: "full",
			},
		})
		setShowCompareConfirm(false)
		setTimeout(() => {
			setCompareDisabled(false)
		}, 2000)
	}

	const handleMouseEnter = () => {
		setHasMouseEntered(true)
	}

	const handleMouseLeave = () => {
		if (hasMouseEntered) {
			setShowRestoreConfirm(false)
			setShowCompareConfirm(false)
			setHasMouseEntered(false)
		}
	}

	const setRefs = useCallback(
		(node: HTMLDivElement | null, type: "button" | "tooltip") => {
			if (type === "button") {
				buttonRef.current = node
				refs.setReference(node)
			} else {
				tooltipRef.current = node
				refs.setFloating(node)
			}
		},
		[refs],
	)

	const handleMouseMove = useCallback(
		(e: MouseEvent) => {
			if (!showRestoreConfirm && !showCompareConfirm) return

			const tooltipElement = tooltipRef.current
			const buttonElement = buttonRef.current

			if (tooltipElement && buttonElement) {
				const tooltipRect = tooltipElement.getBoundingClientRect()
				const buttonRect = buttonElement.getBoundingClientRect()

				const safeZoneLeft = Math.min(tooltipRect.left, buttonRect.left) - 10
				const safeZoneRight = Math.max(tooltipRect.right, buttonRect.right) + 10
				const safeZoneTop = Math.min(tooltipRect.top, buttonRect.top) - 10
				const safeZoneBottom = Math.max(tooltipRect.bottom, buttonRect.bottom) + 10

				if (
					e.clientX >= safeZoneLeft &&
					e.clientX <= safeZoneRight &&
					e.clientY >= safeZoneTop &&
					e.clientY <= safeZoneBottom
				) {
					return
				}

				setShowRestoreConfirm(false)
				setShowCompareConfirm(false)
			}
		},
		[showRestoreConfirm, showCompareConfirm],
	)

	useEffect(() => {
		if (showRestoreConfirm || showCompareConfirm) {
			document.addEventListener("mousemove", handleMouseMove)
			return () => {
				document.removeEventListener("mousemove", handleMouseMove)
			}
		}
	}, [showRestoreConfirm, showCompareConfirm, handleMouseMove])

	const isCheckedOut = currentCheckpointHash === commitHash

	// 根据 type 和 restoreMode 决定显示的按钮
	const renderActionButtons = () => {
		if (type === ("undo_restore" as CheckpointMode)) {
			return (
				<CustomButton
					$isCheckedOut={isCheckedOut}
					disabled={true}
					title="This checkpoint was created by an undo restore operation. To restore again, please operate on the original checkpoint.">
					Undo
				</CustomButton>
			)
		}

		if (type === ("restore" as CheckpointMode)) {
			return (
				<CustomButton $isCheckedOut={isCheckedOut} disabled={restoreDisabled} onClick={handleUndoRestore}>
					Undo
				</CustomButton>
			)
		}

		// type === "create"
		return (
			<CustomButton
				$isCheckedOut={isCheckedOut}
				disabled={restoreDisabled}
				style={{ cursor: restoreDisabled ? "wait" : "pointer" }}
				onClick={handleRestoreClick}>
				Restore
			</CustomButton>
		)
	}

	return (
		<Container $isMenuOpen={showCompareConfirm} $isCheckedOut={isCheckedOut} onMouseLeave={handleMouseLeave}>
			<i
				className="codicon codicon-bookmark"
				style={{
					color: isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)",
					fontSize: "12px",
					flexShrink: 0,
				}}
			/>
			<Label $isCheckedOut={isCheckedOut}>Checkpoint</Label>
			<DottedLine $isCheckedOut={isCheckedOut} />
			<ButtonGroup>
				<div ref={(node) => setRefs(node, "button")} style={{ position: "relative", marginTop: -2 }}>
					<CustomButton
						$isCheckedOut={isCheckedOut}
						disabled={compareDisabled}
						$isActive={showCompareConfirm}
						style={{ cursor: compareDisabled ? "wait" : "pointer" }}
						onClick={() => {
							setShowCompareConfirm(true)
						}}>
						Compare
					</CustomButton>
					{showCompareConfirm &&
						createPortal(
							<RestoreConfirmTooltip
								ref={(node) => setRefs(node, "tooltip")}
								style={floatingStyles}
								data-placement={placement}
								$tooltipType="compare"
								onMouseEnter={handleMouseEnter}
								onMouseLeave={handleMouseLeave}>
								<RestoreOption>
									<Button
										variant="default"
										className="w-full mb-2.5"
										disabled={compareDisabled}
										style={{ cursor: compareDisabled ? "wait" : "pointer" }}
										onClick={handleCompareThisChange}>
										Compare This Change
									</Button>
									<p className="text-muted-foreground text-xs">
										Compare this change with the current state
									</p>
								</RestoreOption>
								<RestoreOption>
									<Button
										variant="default"
										className="w-full mb-2.5"
										disabled={compareDisabled}
										style={{ cursor: compareDisabled ? "wait" : "pointer" }}
										onClick={handleCompareAllChanges}>
										Compare All Changes
									</Button>
									<p className="text-muted-foreground text-xs">
										Compare all changes since task started
									</p>
								</RestoreOption>
							</RestoreConfirmTooltip>,
							document.body,
						)}
				</div>
				<DottedLine $small $isCheckedOut={isCheckedOut} />
				{renderActionButtons()}
				<DottedLine $small $isCheckedOut={isCheckedOut} />
			</ButtonGroup>
			<ConfirmDialog
				isOpen={showConfirmDialog}
				onClose={() => setShowConfirmDialog(false)}
				onConfirm={() => {
					confirmDialogConfig.onConfirm()
					setShowConfirmDialog(false)
				}}
				title={confirmDialogConfig.title}
				description={confirmDialogConfig.description}
			/>
		</Container>
	)
}

const Container = styled.div<{ $isMenuOpen?: boolean; $isCheckedOut?: boolean }>`
	display: flex;
	align-items: center;
	padding: 4px 0;
	gap: 4px;
	position: relative;
	min-width: 0;
	margin-top: 4px;
	margin-bottom: -14px;
	opacity: ${(props) => (props.$isCheckedOut ? 1 : props.$isMenuOpen ? 1 : 0.5)};

	&:hover {
		opacity: 1;
	}
`

const Label = styled.span<{ $isCheckedOut?: boolean }>`
	color: ${(props) =>
		props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"};
	font-size: 9px;
	flex-shrink: 0;
`

const DottedLine = styled.div<{ $small?: boolean; $isCheckedOut?: boolean }>`
	flex: ${(props) => (props.$small ? "0 0 5px" : "1")};
	min-width: ${(props) => (props.$small ? "5px" : "5px")};
	height: 1px;
	background-image: linear-gradient(
		to right,
		${(props) =>
				props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"}
			50%,
		transparent 50%
	);
	background-size: 4px 1px;
	background-repeat: repeat-x;
`

const ButtonGroup = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
	flex-shrink: 0;
	margin-right: 2px;
`

const CustomButton = styled.button<{ disabled?: boolean; $isActive?: boolean; $isCheckedOut?: boolean }>`
	background: ${(props) =>
		props.$isActive || props.disabled
			? props.$isCheckedOut
				? "var(--vscode-textLink-foreground)"
				: "var(--vscode-descriptionForeground)"
			: "transparent"};
	border: none;
	color: ${(props) =>
		props.$isActive || props.disabled
			? "var(--vscode-editor-background)"
			: props.$isCheckedOut
				? "var(--vscode-textLink-foreground)"
				: "var(--vscode-descriptionForeground)"};
	padding: 2px 6px;
	font-size: 9px;
	cursor: pointer;
	position: relative;

	&::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		border-radius: 1px;
		background-image: ${(props) =>
			props.$isActive || props.disabled
				? "none"
				: `linear-gradient(to right, ${props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"} 50%, transparent 50%),
			linear-gradient(to bottom, ${props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"} 50%, transparent 50%),
			linear-gradient(to right, ${props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"} 50%, transparent 50%),
			linear-gradient(to bottom, ${props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"} 50%, transparent 50%)`};
		background-size: ${(props) =>
			props.$isActive || props.disabled ? "auto" : `4px 1px, 1px 4px, 4px 1px, 1px 4px`};
		background-repeat: repeat-x, repeat-y, repeat-x, repeat-y;
		background-position:
			0 0,
			100% 0,
			0 100%,
			0 0;
	}

	&:hover:not(:disabled) {
		background: ${(props) =>
			props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"};
		color: var(--vscode-editor-background);
		&::before {
			display: none;
		}
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const RestoreOption = styled.div`
	&:not(:last-child) {
		margin-bottom: 10px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--vscode-editorGroup-border);
	}

	p {
		margin: 0 0 2px 0;
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
		line-height: 14px;
	}

	&:last-child p {
		margin: 0 0 -2px 0;
	}
`

const RestoreConfirmTooltip = styled.div<{ $tooltipType?: "compare" | "restore" }>`
	position: fixed;
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-editorGroup-border);
	padding: 12px;
	border-radius: 3px;
	margin-top: 8px;
	width: min(calc(100vw - 10vw), 400px);
	z-index: 1000;

	// Add invisible padding to create a safe hover zone
	&::before {
		content: "";
		position: absolute;
		top: -20px; // 增加上方安全区域
		left: -20px; // 增加左侧安全区域
		right: -20px; // 增加右侧安全区域
		bottom: -20px; // 增加下方安全区域
		z-index: -1;
	}

	// Adjust arrow to be above the padding
	&::after {
		content: "";
		position: absolute;
		top: -6px;
		${(props) => (props.$tooltipType === "restore" ? "right: 24px;" : "right: 84px;")}
		width: 10px;
		height: 10px;
		background: var(--vscode-editor-background);
		border-left: 1px solid var(--vscode-editorGroup-border);
		border-top: 1px solid var(--vscode-editorGroup-border);
		transform: rotate(45deg);
		z-index: 1;
	}

	// When menu appears above the button
	&[data-placement^="top"] {
		&::before {
			top: -20px;
			bottom: -20px;
		}

		&::after {
			top: auto;
			bottom: -6px;
			${(props) => (props.$tooltipType === "restore" ? "right: 24px;" : "right: 84px;")}
			transform: rotate(225deg);
		}
	}
`
