import lumenIcon from './lumen-45.svg'

export function IconLumen(props: { size?: number }) {
  return <img src={lumenIcon} alt='' width={props.size ?? 20} height={props.size ?? 20} />
}
