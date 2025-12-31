import { createHashHistory } from 'history'
import { createReduxHistoryContext } from 'redux-first-history'

export const { createReduxHistory, routerMiddleware, routerReducer } = createReduxHistoryContext({
  history: createHashHistory(),
})
