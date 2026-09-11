import { readConfig, blocked } from './config'
import { initSend } from './send'
import { initCohort } from './cohort'
import { initEngage } from './engage'
import { initLinks } from './links'
import { initPage } from './page'

const c = readConfig()

// Blocked pages install no listeners, timers, storage access or history wrappers.
if (c && !blocked(c)) {
  // Initialize transport before other listeners and page lifecycle last: initPage may
  // immediately send a pageview.
  initSend(c)
  initCohort(c)
  initEngage(c)
  initLinks(c)
  initPage(c)
}
