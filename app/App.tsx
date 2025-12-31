import { connect } from 'react-redux'
import { Routes, Route, Navigate } from 'react-router-dom'
import { HistoryRouter as Router } from 'redux-first-history/rr6'
import About from './components/About'
import ChooseStageScene from './components/ChooseStageScene'
import Inspector from './components/dev-only/Inspector'
import Editor from './components/Editor'
import Gallery from './components/Gallery'
import GameoverScene from './components/GameoverScene'
import GameScene from './components/GameScene'
import GameTitleScene from './components/GameTitleScene'
import StageListPageWrapper from './components/StageList'
import { GameRecord } from './reducers/game'
import { firstStageName as fsn } from './stages'
import { State } from './types'
import { history } from './utils/store'

interface AppProps {
  game: GameRecord
}

function App({ game }: AppProps) {
  return (
    <Router history={history}>
      <div style={{ display: 'flex' }}>
        <Routes>
          <Route path="/list/*" element={<StageListPageWrapper />} />
          <Route path="/editor/:view?" element={<Editor />} />
          <Route path="/gallery/:tab?" element={<Gallery />} />
          <Route path="/gameover" element={<GameoverScene />} />
          <Route path="/choose" element={<Navigate to={`/choose/${fsn}`} replace />} />
          <Route path="/choose/:stageName" element={<ChooseStageScene />} />
          <Route path="/stage" element={<Navigate to={`/stage/${fsn}`} replace />} />
          <Route path="/stage/:stageName" element={<GameScene />} />
          <Route path="*" element={<GameTitleScene />} />
        </Routes>
        {DEV.HIDE_ABOUT ? null : <About />}
        {DEV.INSPECTOR && <Inspector />}
      </div>
    </Router>
  )
}

function mapStateToProps(state: State) {
  return { game: state.game }
}

export default connect(mapStateToProps)(App)
