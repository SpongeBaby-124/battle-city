import 'normalize.css'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import App from './App'
import './battle-city.css'
import store from './utils/store'

const container = document.getElementById('container')!
const root = createRoot(container)

root.render(
  <Provider store={store}>
    <App />
  </Provider>
)
