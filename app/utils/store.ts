import { legacy_createStore as createStore, applyMiddleware } from 'redux'
import createSagaMiddleware from 'redux-saga'
import reducer from '../reducers/index'
import rootSaga from '../sagas/index'
import { routerMiddleware, createReduxHistory } from './history'

const sagaMiddleware = createSagaMiddleware()

const store = createStore(reducer, applyMiddleware(routerMiddleware, sagaMiddleware))

sagaMiddleware.run(rootSaga)

export const history = createReduxHistory(store)

export default store
