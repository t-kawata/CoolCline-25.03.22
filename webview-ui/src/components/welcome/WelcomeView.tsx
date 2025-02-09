import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"
import { useTranslation } from "react-i18next"
import LanguageSelector from "../common/LanguageSelector"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()
	const { t } = useTranslation()

	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = (apiErrorMessage !== null && apiErrorMessage !== undefined) || !apiConfiguration?.apiKey

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "0 20px",
			}}>
			<h2>{String(t("welcome.title"))}</h2>
			<p>
				{String(t("welcome.description"))} {String(t("welcome.readmeLink"))}
				{":"}
				<VSCodeLink
					href="https://github.com/coolcline/coolcline/blob/main/README_en.md"
					style={{ display: "inline" }}>
					en
				</VSCodeLink>
				{"|"}
				<VSCodeLink
					href="https://gitee.com/coolcline/coolcline/blob/main/README.md"
					style={{ display: "inline" }}>
					简体中文
				</VSCodeLink>
			</p>

			<LanguageSelector />

			<b>{String(t("welcome.apiProviderNeeded"))}</b>

			<div style={{ marginTop: "10px" }}>
				<ApiOptions />
				<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: "3px" }}>
					{String(t("welcome.letsGo"))}
				</VSCodeButton>
			</div>
		</div>
	)
}

export default WelcomeView
