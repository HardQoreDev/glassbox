// Un modello finto per provare Glassbox in pi senza credenziali: scrive un
// file, poi risponde. Lo usano pi/test.sh e chi vuole vedere il pannello:
//   pi --offline -ne -e pi/test/faux.ts -e pi/src/extension.ts --model faux/faux-1
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'

export default function (pi: any) {
  const provider = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }] })
  provider.setResponses([
    fauxAssistantMessage([fauxToolCall('write', { path: 'prova-glassbox.txt', content: 'una riga\n' })]),
    fauxAssistantMessage("Ho scritto il file di prova. Il rebase riscrive i commit sopra un'altra base, uno alla volta."),
    fauxAssistantMessage('Rebase: sposta i commit.\nUno alla volta.'),
    fauxAssistantMessage('Un fork della sessione risponde così.'),
    fauxAssistantMessage('Altra risposta del modello finto.'),
    fauxAssistantMessage('Altra risposta del modello finto.'),
  ])
  pi.registerProvider(provider.provider)
}
