import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import {
	ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useSnapshots } from './use-snapshots';

interface SiteDetailsContext {
	selectedSite: SiteDetails | null;
	updateSite: ( site: SiteDetails ) => Promise< void >;
	data: SiteDetails[];
	setSelectedSiteId: ( selectedSiteId: string ) => void;
	createSite: ( path: string, siteName?: string ) => Promise< void >;
	startServer: ( id: string ) => Promise< void >;
	stopServer: ( id: string ) => Promise< void >;
	stopAllRunningSites: () => Promise< void >;
	deleteSite: ( id: string, removeLocal: boolean ) => Promise< void >;
	loadingServer: Record< string, boolean >;
	loadingSites: boolean;
	isDeleting: boolean;
	uploadingSites: { [ siteId: string ]: boolean };
	setUploadingSites: React.Dispatch< React.SetStateAction< { [ siteId: string ]: boolean } > >;
}

export const siteDetailsContext = createContext< SiteDetailsContext >( {
	selectedSite: null,
	data: [],
	updateSite: async () => undefined,
	setSelectedSiteId: () => undefined,
	createSite: async () => undefined,
	startServer: async () => undefined,
	stopServer: async () => undefined,
	stopAllRunningSites: async () => undefined,
	deleteSite: async () => undefined,
	isDeleting: false,
	loadingServer: {},
	loadingSites: true,
	uploadingSites: {},
	setUploadingSites: () => undefined,
} );

interface SiteDetailsProviderProps {
	children?: ReactNode;
}

export function useSiteDetails() {
	const context = useContext( siteDetailsContext );
	if ( ! context ) {
		throw new Error( 'useSiteDetails must be used within a SiteDetailsProvider' );
	}
	return context;
}

function useSelectedSite( firstSiteId: string | null ) {
	const SELECTED_SITE_ID_KEY = 'selectedSiteId';
	const selectedSiteIdFromLocal = localStorage.getItem( SELECTED_SITE_ID_KEY ) || null;
	const [ selectedSiteId, setSelectedSiteId ] = useState< string | null >(
		selectedSiteIdFromLocal
	);
	return {
		selectedSiteId: selectedSiteId || firstSiteId,
		setSelectedSiteId: ( id: string ) => {
			setSelectedSiteId( id );
			localStorage.setItem( SELECTED_SITE_ID_KEY, id );
		},
	};
}

function useDeleteSite() {
	const [ isLoading, setIsLoading ] = useState< Record< string, boolean > >( {} );
	const { deleteSnapshot, snapshots } = useSnapshots();

	const deleteSite = useCallback(
		async ( siteId: string, removeLocal: boolean ): Promise< SiteDetails[] | undefined > => {
			const siteSnapshots = snapshots.filter( ( snapshot ) => snapshot.localSiteId === siteId );

			if ( ! siteId ) {
				return;
			}
			const allSiteRemovePromises = Promise.allSettled(
				siteSnapshots.map( ( snapshot ) => deleteSnapshot( snapshot, removeLocal ) )
			);

			try {
				setIsLoading( ( loading ) => ( { ...loading, [ siteId ]: true } ) );
				const newSites = await getIpcApi().deleteSite( siteId, removeLocal );
				await allSiteRemovePromises;
				return newSites;
			} catch ( error ) {
				throw new Error( 'Failed to delete local files' );
			} finally {
				setIsLoading( ( loading ) => ( { ...loading, [ siteId ]: false } ) );
			}
		},
		[ deleteSnapshot, snapshots ]
	);
	return { deleteSite, isLoading };
}

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ data, setData ] = useState< SiteDetails[] >( [] );
	const [ loadingSites, setLoadingSites ] = useState< boolean >( true );
	const firstSite = data[ 0 ] || null;
	const [ loadingServer, setLoadingServer ] = useState< Record< string, boolean > >(
		firstSite?.id
			? {
					[ firstSite?.id ]: true,
			  }
			: {}
	);
	const { selectedSiteId, setSelectedSiteId } = useSelectedSite( firstSite?.id );
	const [ uploadingSites, setUploadingSites ] = useState< { [ siteId: string ]: boolean } >( {} );
	const { deleteSite, isLoading: isDeleting } = useDeleteSite();

	const toggleLoadingServerForSite = useCallback( ( siteId: string ) => {
		setLoadingServer( ( currentLoading ) => ( {
			...currentLoading,
			[ siteId ]: ! currentLoading[ siteId ] || false,
		} ) );
	}, [] );

	useEffect( () => {
		let cancel = false;
		setLoadingSites( true );
		getIpcApi()
			.getSiteDetails()
			.then( ( data ) => {
				if ( ! cancel ) {
					setData( data );
					setLoadingSites( false );
				}
			} );

		return () => {
			cancel = true;
		};
	}, [] );

	const onDeleteSite = useCallback(
		async ( id: string, removeLocal: boolean ) => {
			const newSites = await deleteSite( id, removeLocal );
			if ( newSites ) {
				setData( newSites );
				const selectedSite = newSites.length ? newSites[ 0 ].id : '';
				setSelectedSiteId( selectedSite );
			}
		},
		[ deleteSite, setSelectedSiteId ]
	);

	const createSite = useCallback(
		async ( path: string, siteName?: string ) => {
			const data = await getIpcApi().createSite( path, siteName );
			setData( data );
			const newSite = data.find( ( site ) => site.path === path );
			if ( newSite?.id ) {
				setSelectedSiteId( newSite.id );
			}
		},
		[ setSelectedSiteId ]
	);

	const updateSite = useCallback( async ( site: SiteDetails ) => {
		const updatedSites = await getIpcApi().updateSite( site );
		setData( updatedSites );
	}, [] );

	const startServer = useCallback(
		async ( id: string ) => {
			toggleLoadingServerForSite( id );
			let updatedSite: SiteDetails | null = null;

			try {
				updatedSite = await getIpcApi().startServer( id );
			} catch ( error ) {
				Sentry.captureException( error );
				getIpcApi().showMessageBox( {
					type: 'error',
					message: __( 'Failed to start the site server' ),
					detail: __(
						"Please verify your site's local path directory contains the standard WordPress installation files and try again. If this problem persists, please contact support."
					),
				} );
			}

			if ( updatedSite ) {
				setData( ( prevData ) =>
					prevData.map( ( site ) => ( site.id === id && updatedSite ? updatedSite : site ) )
				);
			}

			toggleLoadingServerForSite( id );
		},
		[ toggleLoadingServerForSite ]
	);

	const stopServer = useCallback(
		async ( id: string ) => {
			toggleLoadingServerForSite( id );
			const updatedSite = await getIpcApi().stopServer( id );
			if ( updatedSite ) {
				setData( ( prevData ) =>
					prevData.map( ( site ) => ( site.id === id ? updatedSite : site ) )
				);
			}
			toggleLoadingServerForSite( id );
		},
		[ toggleLoadingServerForSite ]
	);

	const stopAllRunningSites = useCallback( async () => {
		const runningSites = data.filter( ( site ) => site.running );
		for ( const site of runningSites ) {
			await getIpcApi().stopServer( site.id );
		}
		setData( data.map( ( site ) => ( site.running ? { ...site, running: false } : site ) ) );
	}, [ data ] );

	const context = useMemo(
		() => ( {
			selectedSite: data.find( ( site ) => site.id === selectedSiteId ) || firstSite,
			data,
			setSelectedSiteId,
			createSite,
			updateSite,
			startServer,
			stopServer,
			stopAllRunningSites,
			loadingServer,
			deleteSite: onDeleteSite,
			isDeleting: selectedSiteId ? isDeleting[ selectedSiteId ] : false,
			loadingSites,
			uploadingSites,
			setUploadingSites,
		} ),
		[
			data,
			firstSite,
			setSelectedSiteId,
			createSite,
			updateSite,
			startServer,
			stopServer,
			stopAllRunningSites,
			loadingServer,
			onDeleteSite,
			selectedSiteId,
			isDeleting,
			loadingSites,
			uploadingSites,
		]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
