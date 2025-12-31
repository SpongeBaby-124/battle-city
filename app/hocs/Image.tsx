import React, { createContext, useContext } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Provider, ReactReduxContext } from 'react-redux'

// 创建 Image 上下文
const ImageContext = createContext<{ underImageComponent: boolean }>({
  underImageComponent: false,
})

const cache = new Map<string, string>()

export interface ImageProps {
  disabled?: boolean
  imageKey: string
  transform?: string
  width: string | number
  height: string | number
  children?: React.ReactNode
  className?: string
  style?: any
}

// 包装组件，用于在 renderToStaticMarkup 时提供上下文
function ImageWrapper({ children, store }: { children: React.ReactNode; store: any }) {
  return (
    <Provider store={store}>
      <ImageContext.Provider value={{ underImageComponent: true }}>
        <g>{children}</g>
      </ImageContext.Provider>
    </Provider>
  )
}

export default function Image(props: ImageProps) {
  const { disabled = false, imageKey, width, height, transform, children, ...other } = props
  const imageContext = useContext(ImageContext)
  const reduxContext = useContext(ReactReduxContext)

  if (disabled || imageContext.underImageComponent) {
    // underImageComponent 不能嵌套，如果已经在一个 ImageComponent 下的话，那么只能使用原始的render方法
    return (
      <g transform={transform} {...other}>
        {children}
      </g>
    )
  } else {
    if (!cache.has(imageKey)) {
      DEV.LOG_PERF && console.time(`Image: loading content of ${imageKey}`)
      const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      const element = (
        <ImageWrapper store={reduxContext?.store}>
          {children}
        </ImageWrapper>
      )
      const string = renderToStaticMarkup(element)
      const close = '</svg>'
      const markup = open + string + close
      const blob = new Blob([markup], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      cache.set(imageKey, url)
      DEV.LOG_PERF && console.timeEnd(`Image: loading content of ${imageKey}`)
    }
    return (
      <image
        data-imagekey={imageKey}
        transform={transform}
        href={cache.get(imageKey)}
        width={width}
        height={height}
        {...other}
      />
    )
  }
}
